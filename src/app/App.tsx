import { createPortal } from 'react-dom';
import { createElement, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useAppUpdates } from '../lib/app-updates';
const ScoreHistoryChart = lazy(() => import('./Charts').then((m) => ({ default: m.ScoreHistoryChart })));
import { Apple, Activity, ChartNoAxesColumnIncreasing, CloudFog, CloudRain, CloudSun, Flag, Pencil, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Cloud, Cookie, Droplets, Dumbbell, FileDown, Heart, Image as ImageIcon, Leaf, MessageCircle, Moon, MoreHorizontal, Plus, Scale, Settings2, Sparkles, Sun, Sunrise, Trash2, Waves, X } from 'lucide-react';
import { addFoodEntries, removeFoodEntry, removeMealEntries } from '../lib/db';
import { nutritionTotals } from '../lib/nutrition';
import { nutritionTargetsForDate } from '../lib/score';
import { db, initializeDatabase, updateDayRecord, savePreferences, saveTracker, saveWeeklyReflection, saveWeight } from '../lib/db';
import { addCalendarDays, dateFromKey, localDateKey, mondayWeekStart, prettyDate, shortDate } from '../lib/dates';
import { dailyStreak, hasTrackedAction, nutritionIntakeSummary, scorePeriod, trackerEligibleOnDate, trackerState, weeklyScoreHistory, weeklyStreak } from '../lib/score';
import { defaultPreferences, type Completion, type DayRecord, type FoodEntry, type Preferences, type Tracker, type WeightEntry } from '../lib/types';
import { asDisplayWeight, asStoredKg, buildWeightChartSeries } from '../lib/weight';
import { sortTrackersForSettings } from '../lib/tracker-order';
import { parseMinimaBackup } from '../lib/backups';
import { isValidDayChange } from '../lib/day-inputs';
import { summarizeLearning } from '../lib/learning';
import { searchNotes } from '../lib/note-search';

const iconMap: Record<string, typeof Apple> = { sunrise: Sunrise, sun: Sun, moon: Moon, apple: Apple, cookie: Cookie, scale: Scale, dumbbell: Dumbbell, message: MessageCircle, book: BookOpen, droplets: Droplets, sparkles: Sparkles, leaf: Leaf, heart: Heart, waves: Waves };
const moodIcons = { low: CloudRain, uneven: CloudFog, steady: CloudSun, good: Sun };
const initialDate = localDateKey();
const transition = { type: 'spring' as const, stiffness: 420, damping: 36, mass: .7 };
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> };

function useLocalData() {
  const cachedPrefs = useMemo(() => {
    try {
      const raw = localStorage.getItem('minima:prefs');
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') return { ...defaultPreferences(localDateKey()), ...saved, exPeriods: Array.isArray(saved.exPeriods) ? saved.exPeriods : [] } as Preferences;
      }
    } catch {}
    return defaultPreferences(localDateKey());
  }, []);
  const trackers = useLiveQuery(() => db.trackers.toArray(), [], [] as Tracker[]);
  const days = useLiveQuery(() => db.days.toArray(), [], [] as DayRecord[]);
  const weights = useLiveQuery(() => db.weights.toArray(), [], [] as WeightEntry[]);
  const preferencesRow = useLiveQuery(() => db.preferences.get('main'), [], { id: 'main', value: cachedPrefs });
  const operations = useLiveQuery(() => db.operations.count(), [], 0);
  return { trackers, days, weights, preferences: { ...defaultPreferences(initialDate), ...(preferencesRow?.value ?? cachedPrefs), exPeriods: Array.isArray((preferencesRow?.value ?? cachedPrefs).exPeriods) ? (preferencesRow?.value ?? cachedPrefs).exPeriods : [] }, pending: operations };
}

export function App() {
  const { needRefresh: [needRefresh, setNeedRefresh], checkForUpdates, forceUpdate, checking, updating, error: updateError, lastChecked, buildId } = useAppUpdates();
  const data = useLocalData();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [toast, setToast] = useState('');
  const isPreviouslyReady = false;
  const [ready, setReady] = useState(isPreviouslyReady);
  const [storageError, setStorageError] = useState(false);
  const [storageSlow, setStorageSlow] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const loadLocalData = async () => {
    setStorageError(false);
    setStorageSlow(false);
    const slowTimer = window.setTimeout(() => setStorageSlow(true), 10000);
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }
    try { await initializeDatabase(); setReady(true); }
    catch { setStorageError(true); }
    finally { window.clearTimeout(slowTimer); setStorageSlow(false); }
  };
  useEffect(() => { void loadLocalData(); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let expandedHeight = viewport.height;
    const update = () => {
      expandedHeight = Math.max(expandedHeight, viewport.height);
      const editing = document.activeElement?.matches('input, textarea, select');
      document.documentElement.dataset.keyboard = String(Boolean(editing && expandedHeight - viewport.height > 140));
    };
    viewport.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => { viewport.removeEventListener('resize', update); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update); delete document.documentElement.dataset.keyboard; };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    setIsInstalled(media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const onInstalled = () => { setInstallPrompt(null); setIsInstalled(true); setToast('Minima is on your home screen'); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  useEffect(() => {
    const setOnline = () => setIsOnline(true);
    const setOffline = () => setIsOnline(false);
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOffline);
    return () => { window.removeEventListener('online', setOnline); window.removeEventListener('offline', setOffline); };
  }, []);
  useEffect(() => {
    const queryDate = searchParams.get('date');
    if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate) && queryDate <= localDateKey()) {
      const parsed = dateFromKey(queryDate);
      const roundTrip = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
      if (roundTrip === queryDate) setSelectedDate(queryDate);
    }
  }, [searchParams]);
  useEffect(() => {
    const checkLocalDate = () => {
      const nextDate = localDateKey();
      if (currentDate === nextDate) return;
      setCurrentDate(nextDate);
      setSelectedDate((selected) => selected === currentDate ? nextDate : selected);
    };
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = window.setTimeout(checkLocalDate, Math.max(1_000, nextMidnight.getTime() - now.getTime() + 50));
    window.addEventListener('focus', checkLocalDate);
    document.addEventListener('visibilitychange', checkLocalDate);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', checkLocalDate); document.removeEventListener('visibilitychange', checkLocalDate); };
  }, [currentDate]);
  useEffect(() => {
    const prefs = data.preferences;
    if (!prefs) return;
    document.documentElement.dataset.theme = prefs.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    document.documentElement.style.setProperty('--accent', prefs.accent);
    try {
      localStorage.setItem('minima:theme', prefs.theme);
      localStorage.setItem('minima:accent', prefs.accent);
      localStorage.setItem('minima:prefs', JSON.stringify(prefs));
    } catch {}
  }, [data.preferences]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => { setToast(''); }, 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const navItems = [
    { to: '/', label: 'Today', icon: Sunrise },
    { to: '/calories', label: 'Calories', icon: Apple },
    { to: '/insights', label: 'Insights', icon: ChartNoAxesColumnIncreasing },
    { to: '/history', label: 'History', icon: CalendarDays },
  ];
  if (storageError) return <div className="boot-screen boot-error" role="alert"><div className="boot-mark"><span className="minima-mark" aria-hidden="true"><i/><i/><i/></span></div><strong>Saved data couldn’t open.</strong><button className="primary-button" onClick={() => void loadLocalData()}>Retry</button><a href="/repair.html">Repair app startup</a></div>;
  if (!ready) return <LoadingScreen slow={storageSlow}/>;
  if (!data.preferences) return <LoadingScreen/>;

  const day = data.days.find((item) => item.date === selectedDate);
  const weight = data.weights.find((item) => item.date === selectedDate);
  const activeTrackers = data.trackers.filter((item) => !item.archived);
  const prefs = data.preferences;
  const updateDay = async (change: Partial<DayRecord>) => {
    if (!isValidDayChange(change)) { setToast('Check that value'); return; }
    await updateDayRecord(selectedDate, change);
  };
  const setStatus = async (trackerId: string, state: Completion) => {
    try { await updateDayRecord(selectedDate, { states: { [trackerId]: state } }); }
    catch { setToast('This check-in could not be saved. Try again.'); }
  };
  const updateSelectedDate = (nextDate: string) => {
    if (!nextDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || nextDate > currentDate) return;
    setSelectedDate(nextDate);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextDate === currentDate) next.delete('date');
      else next.set('date', nextDate);
      return next;
    }, { replace: true });
  };
  const changeDate = (delta: number) => {
    const next = addCalendarDays(selectedDate, delta);
    if (next <= currentDate) updateSelectedDate(next);
  };
  const savePrefs = async (next: Preferences) => { await savePreferences(next); };
  const updateTracker = async (tracker: Tracker) => { await saveTracker(tracker); };
  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (result.outcome === 'accepted') setIsInstalled(true);
  };
  const applyPwaUpdate = async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    // Allow blur saves and journal autosave to settle. Drafts remain recoverable.
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    try { await forceUpdate(); }
    catch (cause) { setToast(cause instanceof Error ? cause.message : 'The update could not be applied.'); }
  };
  const checkUpdates = async () => {
    try { setToast(await checkForUpdates() ? '' : 'You’re using the latest release.'); }
    catch (cause) { setToast(cause instanceof Error ? cause.message : 'Updates could not be checked.'); }
  };
  const releaseDate = new Date(buildId.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/, '$1-$2-$3T$4:$5:$6.$7Z'));
  const releaseLabel = Number.isNaN(releaseDate.getTime()) ? buildId : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(releaseDate);
  const updatePanel = <section data-release={buildId} className="app-update-panel" aria-labelledby="app-updates-title">
    <div className="app-update-heading"><div><h2 id="app-updates-title">App updates</h2>{(updating || needRefresh) && <p>{updating ? 'Updating…' : 'Update available'}</p>}</div><span className={`update-state ${needRefresh ? 'available' : ''}`}><ArrowDownLeft size={18}/></span></div>
    <div className="app-update-actions"><button className="secondary-button" disabled={checking || updating} onClick={() => void checkUpdates()} aria-busy={checking}>{checking ? <><span className="inline-spinner" aria-hidden="true"/>Checking…</> : 'Check for updates'}</button><button className="primary-button" disabled={checking || updating} onClick={() => void applyPwaUpdate()} aria-busy={updating}>{updating ? <><span className="inline-spinner" aria-hidden="true"/>Updating…</> : 'Force update'}</button></div>
    {updateError && <p className="app-update-error" role="alert">{updateError}</p>}
    <div className="app-release"><span>Release</span><span>{releaseLabel}</span></div>
    {lastChecked && <small className="app-update-checked">Checked {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(lastChecked)}</small>}
  </section>;

  return (
    <MotionConfig reducedMotion="user">
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <NavLink to="/" className="brand"><span className="minima-mark" aria-hidden="true"><i/><i/><i/></span><span>minima</span></NavLink>
        
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map(({ to, label, icon: Icon }) => <NavLink end={to === '/'} key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={17} strokeWidth={1.7} /><span>{label}</span>{label === 'Today' && <span className="nav-live" />}</NavLink>)}
        </nav>
        <div className="sidebar-bottom"><div className={`sync-pill ${isOnline ? '' : 'is-offline'}`} role="status" aria-live="polite"><span className="sync-dot" /><span>{isOnline ? 'Saved on this device' : 'Offline · saved locally'}</span></div></div>
      </aside>

      <main id="main-content" className="main-area" tabIndex={-1}>
        <header className="topbar">
          <div className="mobile-brand"><span className="minima-mark" aria-hidden="true"><i/><i/><i/></span><span>minima</span></div>
          <div className="breadcrumb"><span>Your space</span><span className="crumb-sep">/</span><b>{navItems.find(({ to }) => to === location.pathname)?.label ?? (location.pathname === '/more' ? 'Settings' : 'Dashboard')}</b></div>
          <div className="top-actions">{!isOnline && <span className="local-status">Offline</span>}<NavLink className={`icon-button settings-button ${location.pathname === '/more' ? 'active' : ''}`} title="Settings" aria-label="Open settings" to="/more"><Settings2 size={17}/></NavLink></div>
        </header>

        <div className="content-area">
          {needRefresh && !toast && <div className="update-notice" role="status"><span>Update available</span><button disabled={updating} onClick={() => void applyPwaUpdate()} aria-busy={updating}>{updating ? <><span className="inline-spinner" aria-hidden="true"/>Updating…</> : 'Update now'}</button><button className="update-dismiss" aria-label="Dismiss update" onClick={() => setNeedRefresh(false)}>Later</button></div>}
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<TodayPage date={selectedDate} currentDate={currentDate} day={day} weight={weight} trackers={data.trackers} preferences={prefs} weights={data.weights} setStatus={setStatus} updateDay={updateDay} changeDate={changeDate} setSelectedDate={updateSelectedDate} onSaveWeight={async (kg) => { if (kg == null) { await db.weights.delete(selectedDate); await setStatus('weight', 'unrecorded'); } else { await saveWeight({ date: selectedDate, kg, updatedAt: Date.now() }); await setStatus('weight', 'done'); } }} />} />
              <Route path="/calories" element={<CaloriePage date={selectedDate} currentDate={currentDate} day={day} preferences={prefs} trackers={activeTrackers} updateDay={updateDay} setStatus={setStatus} changeDate={changeDate} setSelectedDate={updateSelectedDate} onToast={setToast} />} />
              <Route path="/insights" element={<InsightsPage days={data.days} weights={data.weights} trackers={data.trackers} preferences={prefs} />} />
              <Route path="/history" element={<HistoryPage days={data.days} weights={data.weights} trackers={data.trackers} preferences={prefs} selectedDate={selectedDate} setSelectedDate={updateSelectedDate} onOpenDay={(date) => navigate(`/?date=${date}`)} />} />
              <Route path="/more" element={<MorePage trackers={data.trackers} preferences={prefs} pending={data.pending} installReady={Boolean(installPrompt)} isInstalled={isInstalled} onInstall={installApp} onSavePreferences={savePrefs} onSaveTracker={updateTracker} onToast={setToast} updatePanel={updatePanel} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AnimatePresence>
        </div>
        <nav className="mobile-nav" aria-label="Main navigation">{navItems.map(({ to, label, icon: Icon }) => <NavLink end={to === '/'} key={to} to={to} className={({ isActive }) => `mobile-nav-link ${isActive ? 'active' : ''}`}>{({ isActive }) => <>{isActive && <motion.span className="dock-selection" layoutId="minima-dock-selection" transition={transition}/>}<span className="dock-icon"><Icon size={21} strokeWidth={1.8}/></span><span className="dock-label">{label}</span></>}</NavLink>)}</nav>
      </main>
      <AnimatePresence>{toast && <motion.div role="status" aria-live="polite" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="toast">{toast}</motion.div>}</AnimatePresence>
      <div className="bottom-safe" />
    </div>
    </MotionConfig>
  );
}

function LoadingScreen({ slow = false }: { slow?: boolean }) {
  return <div className="startup-shell loading-screen" role="status" aria-busy="true">
    <span className="startup-logo" aria-hidden="true"><i/><i/><i/></span>
    <span className="startup-wordmark">minima</span>
    <p className="loading-caption">{slow ? 'Storage is taking longer than expected. Close other Minima tabs and try again.' : 'Opening your space…'}</p>
    <a className="startup-help" href="/repair.html">Having trouble opening?</a>
  </div>;
}

function ChartLoading() {
  return <div className="chart-skeleton" role="status" aria-label="Loading score chart" aria-busy="true"><span>Loading chart…</span></div>;
}

function ProgressRing({ value, label, caption = 'SCORE' }: { value: number | null; label: string; caption?: string }) {
  const length = 2 * Math.PI * 54;
  return <div className="progress-ring" role="progressbar" aria-label={label} aria-valuenow={value ?? undefined} aria-valuetext={value == null ? "No recorded score yet" : undefined} aria-valuemin={0} aria-valuemax={100}>
    <svg viewBox="0 0 128 128" aria-hidden="true"><circle className="ring-track" cx="64" cy="64" r="54"/><motion.circle className="ring-fill" cx="64" cy="64" r="54" strokeDasharray={length} initial={false} animate={{ strokeDashoffset: length * (1 - (value ?? 0) / 100) }} transition={transition}/></svg>
    <div><strong>{value == null ? '—' : value}{value != null && <small>%</small>}</strong>{caption && <span>{caption}</span>}</div>
  </div>;
}

function PageHeader({ eyebrow, title, subtitle, right }: { eyebrow: string; title: string; subtitle: string; right?: React.ReactNode }) {
  return <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{right && <div className="header-right">{right}</div>}</motion.div>;
}

function TodayPage(props: { date: string; currentDate: string; day?: DayRecord; weight?: WeightEntry; trackers: Tracker[]; preferences: Preferences; weights: WeightEntry[]; setStatus: (id: string, state: Completion) => Promise<void>; updateDay: (change: Partial<DayRecord>) => Promise<void>; changeDate: (delta: number) => void; setSelectedDate: (date: string) => void; onSaveWeight: (kg: number | null) => Promise<void> }) {
  const { date, day, preferences: prefs } = props;
  const trackers = props.trackers.filter((tracker) => trackerEligibleOnDate(tracker, date));
  const isToday = date === props.currentDate;
  const dateLabel = prettyDate(date, { month: 'short', day: 'numeric' });
  const eligibleTrackers = trackers;
  const habitTrackers = sortTrackersForSettings(trackers).filter((tracker) => !['breakfast','lunch','dinner','snacks','nutrition','weight'].includes(tracker.id));
  const eligibleStates = eligibleTrackers.map((tracker) => trackerState(day, tracker.id, prefs, tracker.id === 'weight' && Boolean(props.weight)));
  const completeCount = eligibleStates.filter((state) => state === 'done').length;
  const progress = eligibleTrackers.length ? Math.round(completeCount / eligibleTrackers.length * 100) : 0;
  const weightDraftKey = `minima-weight-draft:${date}:${prefs.weightUnit}`;
  const [weightText, setWeightText] = useState(() => {
    try { const draft = localStorage.getItem(weightDraftKey); if (draft != null) return draft; } catch { /* Continue with IndexedDB. */ }
    return props.weight ? String(asDisplayWeight(props.weight.kg, prefs.weightUnit)) : '';
  });
  const [weightError, setWeightError] = useState('');
  const [confirmWeightRemoval, setConfirmWeightRemoval] = useState(false);
  const [workoutNoteText, setWorkoutNoteText] = useState(day?.workoutNote ?? '');
  useEffect(() => {
    setWorkoutNoteText(day?.workoutNote ?? '');
  }, [day?.workoutNote, date]);
  useEffect(() => {
    if (workoutNoteText === (day?.workoutNote ?? '')) return;
    const timeout = window.setTimeout(() => {
      props.updateDay({ workoutNote: workoutNoteText.trim() || undefined });
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [workoutNoteText, date]);
  useEffect(() => {
    try { const draft = localStorage.getItem(weightDraftKey); if (draft != null) { setWeightText(draft); return; } } catch { /* Continue with IndexedDB. */ }
    setWeightText(props.weight ? String(asDisplayWeight(props.weight.kg, prefs.weightUnit)) : '');
  }, [props.weight?.kg, date, prefs.weightUnit]);
  useEffect(() => { setWeightError(''); }, [date, prefs.weightUnit]);

  const cycle = (id: string) => {
    const current = trackerState(day, id, prefs, id === 'weight' && Boolean(props.weight));
    const next: Completion = current === 'done' ? 'unrecorded' : 'done';
    props.setStatus(id, next);
  };
  const saveWeightText = async () => {
    if (!weightText) return;
    const value = Number(weightText);
    const kg = asStoredKg(value, prefs.weightUnit);
    if (!Number.isFinite(kg) || kg < 25 || kg > 350) {
      setWeightText(props.weight ? String(asDisplayWeight(props.weight.kg, prefs.weightUnit)) : '');
      setWeightError(prefs.weightUnit === 'kg' ? 'Use a value between 25–350 kg' : 'Use a value between 55–770 lb');
      try { localStorage.removeItem(weightDraftKey); } catch { /* IndexedDB remains the durable source. */ }
      return;
    }
    try {
      await props.onSaveWeight(Number(kg.toFixed(3)));
      setWeightError('');
      try { localStorage.removeItem(weightDraftKey); } catch { /* IndexedDB has the saved value. */ }
    } catch { setWeightError('This weight could not be saved. Try again.'); }
  };
  const datePicker = <div className="date-picker"><button className="icon-button" aria-label="Previous day" onClick={() => props.changeDate(-1)}><ChevronLeft size={17}/></button><label className="date-label"><CalendarDays size={15}/><span>{dateLabel}</span><input aria-label="Choose a date" type="date" value={date} max={props.currentDate} onChange={(event) => { const val = event.target.value; if (val && val <= props.currentDate) props.setSelectedDate(val); }} /></label><button className="icon-button" aria-label="Next day" disabled={date >= props.currentDate} onClick={() => props.changeDate(1)}><ChevronRight size={17}/></button></div>;

  return <motion.section className="page today-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={transition}>
    <PageHeader eyebrow={prettyDate(date, { weekday: 'long' })} title="Today" subtitle="" right={datePicker}/>

    <div className="week-rail" aria-label="Choose day this week">
      {Array.from({ length: 7 }, (_, index) => {
        const key = addCalendarDays(mondayWeekStart(date), index);
        return <button key={key} disabled={key > props.currentDate} aria-pressed={key === date} aria-label={prettyDate(key, { weekday: 'long', month: 'long', day: 'numeric' })} onClick={() => props.setSelectedDate(key)}>
          <span>{prettyDate(key, { weekday: 'short' }).slice(0, 1)}</span><b>{dateFromKey(key).getDate()}</b><i/>
        </button>;
      })}
    </div>
    <section className="daily-overview" aria-label="Daily habit progress">
      <div className="overview-copy"><div className="card-kicker">DAILY PROGRESS</div><div className="overview-count">{completeCount}<span> / {eligibleTrackers.length}</span></div><p>habits complete</p></div>
      <ProgressRing value={progress} label="Habit progress" caption="" />
    </section>
    <div className="tracking-grid">
      {trackers.some((tracker) => tracker.id === 'weight') && <section className="surface-card weight-card"><div className="card-heading"><div className="heading-icon body-icon"><Scale size={17}/></div><div><h3>Weight</h3></div></div><div className="weight-entry"><div className="weight-input-wrap"><input aria-label={`Body weight in ${prefs.weightUnit}`} aria-invalid={Boolean(weightError)} inputMode="decimal" type="number" min={prefs.weightUnit === 'kg' ? 25 : 55} max={prefs.weightUnit === 'kg' ? 350 : 772} step="0.1" placeholder="—" value={weightText} onChange={(e) => { const val = e.target.value; setWeightText(val); setWeightError(''); try { if (val.trim()) localStorage.setItem(weightDraftKey, val); else localStorage.removeItem(weightDraftKey); } catch {} }} onBlur={saveWeightText}/><span>{prefs.weightUnit}</span></div></div>{weightError && <p className="weight-error" role="alert">{weightError}</p>}<div className="weight-meta"><span>{props.weights.length ? `Latest · ${asDisplayWeight(props.weights.at(-1)!.kg, prefs.weightUnit)} ${prefs.weightUnit}` : 'No entries yet'}</span>{props.weight && <button className="text-button" onClick={() => setConfirmWeightRemoval(true)}>Remove</button>}</div></section>}

      {habitTrackers.length > 0 && <section className="surface-card habits-card">
        <div className="section-heading"><h2>Habits</h2></div>
        <div className="habit-tiles">{habitTrackers.map((tracker) => <TrackerRow key={tracker.id} tracker={tracker} state={trackerState(day, tracker.id, prefs)} onCycle={() => cycle(tracker.id)} onSet={(state) => props.setStatus(tracker.id, state)} />)}</div>
        {day?.states.workout === 'done' && <label className="workout-note"><span>Movement note <small>OPTIONAL</small></span><input value={workoutNoteText} maxLength={140} placeholder="Walked after lunch, stretched…" onChange={(event) => setWorkoutNoteText(event.target.value)} onBlur={() => { if (workoutNoteText !== (day?.workoutNote ?? '')) { props.updateDay({ workoutNote: workoutNoteText.trim() || undefined }); } }}/></label>}
      </section>}

    </div>
    
    {(day?.focusMinutes != null || day?.readingMinutes != null || day?.technicalLearningMinutes != null || day?.problemSolvingMinutes != null) && <section className="today-focus-summary" aria-label="Today's focus and learning"><div><div>{day?.focusMinutes != null && <b>Focus {day.focusMinutes}m</b>}{day?.readingMinutes != null && <b>Reading {day.readingMinutes}m</b>}{(day?.technicalLearningMinutes != null || day?.problemSolvingMinutes != null) && <b>Practice {(day.technicalLearningMinutes ?? 0) + (day.problemSolvingMinutes ?? 0)}m</b>}</div></div></section>}

    
    <section className="mood-section" aria-labelledby="mood-heading">
      <div className="section-label"><h2 id="mood-heading">Mood</h2></div>
      <div className="weather-options" role="radiogroup" aria-label="Daily mood">
        {(['low', 'uneven', 'steady', 'good'] as const).map((level) => {
          const Icon = moodIcons[level];
          return <button key={level} className={`weather-choice weather-${level}`} role="radio" aria-checked={day?.mood === level} onClick={() => props.updateDay({ mood: day?.mood === level ? undefined : level })}><Icon size={22} strokeWidth={1.7}/><span>{level[0].toUpperCase() + level.slice(1)}</span></button>;
        })}
      </div>
    </section>

    <AnimatePresence>
      {confirmWeightRemoval && <ConfirmDialog title="Remove weight entry?" message="This removes the measurement for this day." cancelLabel="Keep entry" confirmLabel="Remove entry" onCancel={() => setConfirmWeightRemoval(false)} onConfirm={async () => { await props.onSaveWeight(null); try { localStorage.removeItem(weightDraftKey); } catch { /* IndexedDB remains the durable source. */ } setConfirmWeightRemoval(false); }} />}
    </AnimatePresence>
  </motion.section>;
}

function TrackerRow({ tracker, state, onCycle, onSet, compact = false }: { tracker: Tracker; state: Completion; onCycle?: () => void; onSet?: (state: Completion) => void; compact?: boolean }) {
  const Icon = iconMap[tracker.icon] ?? Sparkles;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAbove, setMenuAbove] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const updateMenuPlacement = () => {
    const row = rowRef.current?.getBoundingClientRect();
    if (!row) return;
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
    const dock = document.querySelector<HTMLElement>('.mobile-nav');
    const dockTop = dock && getComputedStyle(dock).display !== 'none' ? dock.getBoundingClientRect().top : viewportBottom;
    const availableBelow = Math.min(viewportBottom, dockTop) - row.bottom - 12;
    const availableAbove = row.top - viewportTop - 12;
    setMenuAbove(availableBelow < 120 && availableAbove > availableBelow);
  };
  useEffect(() => {
    if (!menuOpen) return;
    updateMenuPlacement();
    const close = (event: PointerEvent) => { if (!rowRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); optionsRef.current?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', updateMenuPlacement);
    window.addEventListener('scroll', updateMenuPlacement, { passive: true });
    window.visualViewport?.addEventListener('resize', updateMenuPlacement);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', updateMenuPlacement);
      window.removeEventListener('scroll', updateMenuPlacement);
      window.visualViewport?.removeEventListener('resize', updateMenuPlacement);
    };
  }, [menuOpen]);
  const mark = state === 'done' ? <Check size={14} strokeWidth={2.5}/> : state === 'missed' ? <X size={13}/> : null;
  const className = `tracker-row ${compact ? 'compact' : ''} ${state === 'done' ? 'is-done' : ''} ${state === 'missed' ? 'is-missed' : ''}`;
  const content = <><span className="tracker-leading" style={{ '--tracker-color': tracker.color } as React.CSSProperties}><Icon size={20}/></span><span className="tracker-name">{tracker.name}</span><span className={`check-button ${state}`} aria-hidden="true">{mark}</span></>;
  return <div ref={rowRef} className={`tracker-item ${menuOpen ? 'has-menu' : ''}`}>
    {onCycle ? <motion.button type="button" className={className} aria-label={`${tracker.name}: ${state}. Click to ${state === 'done' ? 'clear check-in' : 'mark done'}`} onClick={onCycle} whileTap={{ scale: .97 }} transition={transition}>{content}</motion.button> : <div className={className} aria-label={`${tracker.name}: ${state}`}>{content}</div>}
    {onSet && <button ref={optionsRef} className="tracker-options" aria-label={`Options for ${tracker.name}`} aria-expanded={menuOpen} onClick={() => { updateMenuPlacement(); setMenuOpen(!menuOpen); }}><MoreHorizontal size={16}/></button>}
    {menuOpen && onSet && <div className="tracker-popover" data-side={menuAbove ? 'above' : 'below'} role="group" aria-label={`${tracker.name} options`}><button onClick={() => { onSet('missed'); setMenuOpen(false); optionsRef.current?.focus(); }}><X size={15}/>Mark missed</button><button onClick={() => { onSet('unrecorded'); setMenuOpen(false); optionsRef.current?.focus(); }}>Clear check-in</button></div>}
  </div>;
}

function InstallCard({ installReady, isInstalled, onInstall }: { installReady: boolean; isInstalled: boolean; onInstall: () => Promise<void> }) {
  if (isInstalled) return null;
  return <section className="install-card"><div className="install-emblem"><span className="minima-mark" aria-hidden="true"><i/><i/><i/></span></div><div className="install-copy"><h2>Install Minima</h2>{!installReady && <p>Browser menu → Install app</p>}</div>{installReady && <button className="install-button" onClick={() => void onInstall()}><Plus size={15}/>Install</button>}</section>;
}

function ConfirmDialog({ title, message, cancelLabel, confirmLabel, onCancel, onConfirm }: { title: string; message: string; cancelLabel: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onCancel(); return; }
      if (event.key !== 'Tab') return;
      const items = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeys);
    return () => { window.removeEventListener('keydown', handleKeys); previouslyFocused?.focus(); };
  }, []);
  return <motion.div className="modal-backdrop confirm-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onCancel()}><motion.section ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message" tabIndex={-1} initial={{ opacity: 0, y: 14, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .98 }}><div className="confirm-mark"><CircleHelp size={19}/></div><h2 id="confirm-dialog-title">{title}</h2><p id="confirm-dialog-message">{message}</p><div className="confirm-actions"><button className="secondary-button" autoFocus onClick={onCancel}>{cancelLabel}</button><button className="danger-button" onClick={() => void onConfirm()}>{confirmLabel}</button></div></motion.section></motion.div>;
}

function HistoryPage({ days, weights, trackers, preferences, selectedDate, setSelectedDate, onOpenDay }: { days: DayRecord[]; weights: WeightEntry[]; trackers: Tracker[]; preferences: Preferences; selectedDate: string; setSelectedDate: (date: string) => void; onOpenDay: (date: string) => void }) {
  const [month, setMonth] = useState(() => new Date(dateFromKey(selectedDate).getFullYear(), dateFromKey(selectedDate).getMonth(), 1));
  const [noteQuery, setNoteQuery] = useState('');
  const searchResults = useMemo(() => {
    return searchNotes([], days, noteQuery, 8);
  }, [days, noteQuery]);
  const firstDay = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = localDateKey();
  const monthName = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month);
  const recordMap = new Map(days.map((item) => [item.date, item]));
  const weightDays = new Set(weights.map((entry) => entry.date));
  const selected = recordMap.get(selectedDate);
  const eligibleTrackers = trackers.filter((tracker) => trackerEligibleOnDate(tracker, selectedDate));
  return <motion.section className="page history-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={transition}>
    <PageHeader eyebrow="" title="History" subtitle=""/>
    <div className="history-grid"><section className="surface-card calendar-card"><div className="calendar-head"><div><h2>{monthName}</h2></div><div className="calendar-arrows"><button className="icon-button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={17}/></button><button className="icon-button" aria-label="Next month" disabled={month.getFullYear() === dateFromKey(today).getFullYear() && month.getMonth() === dateFromKey(today).getMonth()} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={17}/></button></div></div>
      <div className="calendar-grid weekdays">{['M','T','W','T','F','S','S'].map((label, i) => <span key={`${label}-${i}`}>{label}</span>)}</div><div className="calendar-grid">{Array.from({ length: firstDay }, (_, index) => <span key={`blank-${index}`} className="calendar-blank"/>)}{Array.from({ length: daysInMonth }, (_, index) => { const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`; const record = recordMap.get(date); const stateCount = Object.values(record?.states ?? {}).filter((value) => value !== 'unrecorded').length; const doneCount = Object.values(record?.states ?? {}).filter((value) => value === 'done').length; const future = date > today; return <button key={date} aria-label={prettyDate(date, { weekday: 'long', month: 'long', day: 'numeric' })} aria-pressed={selectedDate === date} disabled={future} className={`calendar-day ${selectedDate === date ? 'selected' : ''} ${date === today ? 'today' : ''} ${stateCount > 0 ? 'has-record' : ''}`} onClick={() => setSelectedDate(date)}><span>{index + 1}</span><span className="calendar-dots">{weightDays.has(date) && <i className="weight-dot"/>}{stateCount > 0 && <i className={doneCount === stateCount ? 'done-dot' : 'partial-dot'}/>}</span></button>; })}</div>
      <div className="calendar-legend"><span><i className="done-dot"/> Logged activity</span><span><i className="weight-dot"/> Weight entry</span><span><i className="partial-dot"/> Partial / missed</span></div>
    </section>
    <section className="surface-card selected-day-card"><div className="selected-day-heading"><h2>{prettyDate(selectedDate, { weekday: 'long', month: 'short', day: 'numeric' })}</h2><button className="icon-button" aria-label="Open this day" onClick={() => onOpenDay(selectedDate)}><ArrowUpRight size={18}/></button></div><div className="history-stats"><div><b>{eligibleTrackers.filter((tracker) => trackerState(selected, tracker.id, preferences, tracker.id === 'weight' && weightDays.has(selectedDate)) === 'done').length}</b><span>done</span></div><div><b>{eligibleTrackers.filter((tracker) => trackerState(selected, tracker.id, preferences, tracker.id === 'weight' && weightDays.has(selectedDate)) === 'missed').length}</b><span>missed</span></div><div><b>{eligibleTrackers.filter((tracker) => trackerState(selected, tracker.id, preferences, tracker.id === 'weight' && weightDays.has(selectedDate)) === 'unrecorded').length}</b><span>open</span></div></div><details className="history-day-details"><summary><span>Check-ins</span><span>View & edit<ChevronDown size={15}/></span></summary><div className="history-list">{eligibleTrackers.map((tracker) => <TrackerRow key={tracker.id} tracker={tracker} state={trackerState(selected, tracker.id, preferences, tracker.id === 'weight' && weightDays.has(selectedDate))} compact onSet={tracker.id === 'nutrition' || tracker.id === 'weight' ? undefined : (state) => void updateDayRecord(selectedDate, { states: { [tracker.id]: state } })} onCycle={tracker.id === 'nutrition' || tracker.id === 'weight' ? undefined : async () => { const current = trackerState(selected, tracker.id, preferences, tracker.id === 'weight' && weightDays.has(selectedDate)); const next = current === 'done' ? 'unrecorded' : 'done'; await updateDayRecord(selectedDate, { states: { [tracker.id]: next } }); }}/>)}</div></details></section></div>
    {days.some((day) => day.learningNote?.trim()) && <section className="surface-card journal-search-card">
      <div className="journal-search-heading">
        <div>
          
          <h2>Learning notes</h2>
        </div>
      </div>
      <div className="journal-search-input">
        <input
          aria-label="Search learning notes"
          placeholder="Search learning notes…"
          value={noteQuery}
          onChange={(e) => setNoteQuery(e.target.value)}
        />
        {noteQuery && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            onClick={() => setNoteQuery('')}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {noteQuery.trim() && (
        <div className="journal-search-results">
          {searchResults.length === 0 ? (
            <p>No notes found matching “{noteQuery.trim()}”</p>
          ) : (
            searchResults.map((result) => (
              <button
                key={`${result.type}-${result.date}`}
                type="button"
                onClick={() => {
                  setSelectedDate(result.date);
                  setMonth(new Date(dateFromKey(result.date).getFullYear(), dateFromKey(result.date).getMonth(), 1));
                }}
              >
                <span>
                  <b>{prettyDate(result.date, { month: 'short', day: 'numeric', year: 'numeric' })} · {result.type}</b>
                  <small>{result.body}</small>
                </span>
                <ArrowRight size={14} />
              </button>
            ))
          )}
        </div>
      )}
    </section>}
    
  </motion.section>;
}

function CaloriePage(props: {
  date: string;
  currentDate: string;
  day?: DayRecord;
  preferences: Preferences;
  trackers: Tracker[];
  updateDay: (change: Partial<DayRecord>) => Promise<void>;
  setStatus: (id: string, state: Completion) => Promise<void>;
  changeDate: (delta: number) => void;
  setSelectedDate: (date: string) => void;
  onToast: (message: string) => void;
}) {
  const { date, currentDate, day, preferences, updateDay, setStatus, changeDate, setSelectedDate, onToast } = props;
  const isToday = date === currentDate;
  const targets = nutritionTargetsForDate(preferences, date);
  const dateLabel = prettyDate(date, { month: 'short', day: 'numeric' });
  const entries = day?.foodEntries ?? [];

  type MealChoice = 'breakfast' | 'lunch' | 'snacks' | 'dinner' | 'extra';
  const mealOptions: { id: MealChoice; label: string; trackerId: 'breakfast' | 'lunch' | 'snacks' | 'dinner' | null }[] = [
    { id: 'breakfast', label: 'Breakfast', trackerId: 'breakfast' },
    { id: 'lunch', label: 'Lunch', trackerId: 'lunch' },
    { id: 'snacks', label: 'Snack', trackerId: 'snacks' },
    { id: 'dinner', label: 'Dinner', trackerId: 'dinner' },
    { id: 'extra', label: 'Extra', trackerId: null },
  ];

  const [selectedMeal, setSelectedMeal] = useState<MealChoice>(() => {
    const hour = new Date().getHours();
    if (hour < 11) return 'breakfast';
    if (hour < 16) return 'lunch';
    if (hour < 20) return 'snacks';
    return 'dinner';
  });
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<{ data: string; mimeType: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [estimates, setEstimates] = useState<FoodEntry[] | null>(null);
  const [estimateNote, setEstimateNote] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualKcal, setManualKcal] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');
  const [isLoggingMeal, setIsLoggingMeal] = useState(false);
  const [confirmDeleteMeal, setConfirmDeleteMeal] = useState<MealChoice | null>(null);

  const [showFoodSheet, setShowFoodSheet] = useState(false);
  const [sheetViewport, setSheetViewport] = useState<{ height: number; top: number } | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const sheetBusyRef = useRef(false);
  sheetBusyRef.current = isLoggingMeal;

  useEffect(() => {
    if (!showFoodSheet) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const wasInert = shell?.inert ?? false;
    const scrollPosition = window.scrollY;
    const previousStyles = { overflow: document.body.style.overflow, position: document.body.style.position, top: document.body.style.top, width: document.body.style.width };
    if (shell) shell.inert = true;
    Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', top: `-${scrollPosition}px`, width: '100%' });
    const viewport = window.visualViewport;
    const syncViewport = () => setSheetViewport(viewport ? { height: viewport.height, top: viewport.offsetTop } : null);
    syncViewport();
    viewport?.addEventListener('resize', syncViewport);
    viewport?.addEventListener('scroll', syncViewport);
    const frame = requestAnimationFrame(() => sheetRef.current?.querySelector<HTMLButtonElement>('.food-sheet-close')?.focus({ preventScroll: true }));
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!sheetBusyRef.current) setShowFoodSheet(false);
      }
      if (event.key !== 'Tab') return;
      const items = [...(sheetRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex="0"]') ?? [])].filter((item) => item.getClientRects().length > 0);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sheetRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !sheetRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeys);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', syncViewport);
      viewport?.removeEventListener('scroll', syncViewport);
      window.removeEventListener('keydown', handleKeys);
      if (shell) shell.inert = wasInert;
      Object.assign(document.body.style, previousStyles);
      window.scrollTo(0, scrollPosition);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [showFoodSheet]);


  useEffect(() => {
    analysisAbortRef.current?.abort();
    setAnalyzing(false);
    setShowFoodSheet(false);
    setEstimates(null);
    setDescription('');
    setPhoto(null);
    setEstimateNote('');
    setAnalysisError('');
    setManualName(''); setManualKcal(''); setManualProtein(''); setManualCarbs(''); setManualFat(''); setShowManual(false);
    return () => analysisAbortRef.current?.abort();
  }, [date]);

  const calculateTotals = (items: FoodEntry[]) => {
    if (items.length === 0) {
      return {
        calories: undefined,
        protein: undefined,
        carbs: undefined,
        fat: undefined,
      };
    }
    return {
      calories: items.reduce((sum, entry) => sum + (entry.calories || 0), 0),
      protein: Number(items.reduce((sum, entry) => sum + (entry.protein ?? 0), 0).toFixed(1)),
      carbs: Number(items.reduce((sum, entry) => sum + (entry.carbs ?? 0), 0).toFixed(1)),
      fat: Number(items.reduce((sum, entry) => sum + (entry.fat ?? 0), 0).toFixed(1)),
    };
  };

  const intake = nutritionTotals(day);
  const totalCalories = intake.calories;
  const totalProtein = intake.protein;
  const totalCarbs = intake.carbs;
  const totalFat = intake.fat;
  const listedCalories = entries.reduce((sum, entry) => sum + entry.calories, 0);
  const unitemizedCalories = Math.max(0, (totalCalories ?? 0) - listedCalories);
  const estimateTotals = estimates ? calculateTotals(estimates) : null;

  const removeFood = async (id: string) => {
    try {
      await removeFoodEntry(date, id);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not remove this food. Try again.');
    }
  };

  const deleteMeal = async (mealToDelete: MealChoice) => {
    try {
      await removeMealEntries(date, mealToDelete);
      setConfirmDeleteMeal(null);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not delete this meal. Try again.');
    }
  };

  const currentOption = mealOptions.find((m) => m.id === selectedMeal)!;
  const currentTrackerId = currentOption.trackerId;
  const currentMealDone = Boolean(currentTrackerId && day?.states[currentTrackerId] === 'done');

  const analyzeMeal = async () => {
    if (analyzing) return;
    if (!description.trim() && !photo) { setAnalysisError('Add a description, photo, or both.'); return; }
    setAnalyzing(true); setAnalysisError(''); setEstimates(null); setEstimateNote('');
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    try {
      const response = await fetch('/api/analyze-food', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: description, meal: selectedMeal, image: photo })
      });
      const payload = await response.json() as { items?: Array<Omit<FoodEntry, 'id'>>; note?: string; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error || 'Meal analysis failed.');
      const items = Array.isArray(payload.items) ? payload.items : [];
      setEstimates(items.map((item) => ({ ...item, id: crypto.randomUUID(), meal: selectedMeal })));
      setEstimateNote(payload.note ?? '');
      if (!items.length) setAnalysisError(payload.note || 'No food was identified. Add more detail and try again.');
    } catch (error) { if (!controller.signal.aborted) setAnalysisError(error instanceof Error ? error.message : 'Meal analysis failed.'); }
    finally { if (analysisAbortRef.current === controller) { analysisAbortRef.current = null; setAnalyzing(false); } }
  };

  const removeEstimate = (id: string) => {
    setEstimates((current) => {
      if (!current) return null;
      const next = current.filter((item) => item.id !== id);
      return next.length ? next : null;
    });
  };

  const confirmLogAiMeal = async () => {
    if (!estimates?.length || isLoggingMeal) return;
    setIsLoggingMeal(true);
    setAnalysisError('');
    try {
      const trackerId = currentOption.trackerId;
      await addFoodEntries(date, estimates.map((item) => ({ ...item, meal: selectedMeal })), trackerId);
      setEstimates(null); setDescription(''); setPhoto(null); setEstimateNote(''); setAnalysisError('');
      setShowFoodSheet(false);

    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Could not save this food. Try again.');
    } finally {
      setIsLoggingMeal(false);
    }
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingMeal) return;
    setIsLoggingMeal(true);
    setAnalysisError('');
    try {
      const name = manualName.trim();
      const kcal = Number(manualKcal);
      const p = manualProtein.trim() ? Number(manualProtein) : 0;
      const c = manualCarbs.trim() ? Number(manualCarbs) : 0;
      const f = manualFat.trim() ? Number(manualFat) : 0;
      if (!name || !Number.isFinite(kcal) || kcal < 0 || kcal > 20000) return;
      const newEntry: FoodEntry = {
        id: crypto.randomUUID(),
        name,
        meal: selectedMeal,
        calories: Math.round(kcal),
        protein: Number.isFinite(p) && p >= 0 ? Number(p.toFixed(1)) : 0,
        carbs: Number.isFinite(c) && c >= 0 ? Number(c.toFixed(1)) : 0,
        fat: Number.isFinite(f) && f >= 0 ? Number(f.toFixed(1)) : 0,
      };
      const trackerId = currentOption.trackerId;
      await addFoodEntries(date, [newEntry], trackerId);
      analysisAbortRef.current?.abort();
      setAnalyzing(false);
      setManualName(''); setManualKcal(''); setManualProtein(''); setManualCarbs(''); setManualFat(''); setShowManual(false);
      setShowFoodSheet(false);

    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Could not save this food. Try again.');
    } finally {
      setIsLoggingMeal(false);
    }
  };

  const selectPhoto = async (file?: File) => {
    if (!file) return;
    setAnalysisError(''); setPhoto(null);
    if (!file.type.startsWith('image/')) { setAnalysisError('Please choose an image file (JPEG, PNG, WebP).'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Could not read that photo.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not prepare that photo.')), 'image/jpeg', 0.82));
      const reader = new FileReader();
      reader.onload = () => setPhoto({ data: String(reader.result), mimeType: 'image/jpeg' });
      reader.onerror = () => setAnalysisError('Could not read that photo.');
      reader.readAsDataURL(blob);
    } catch { setAnalysisError('Could not prepare that photo. Try another image.'); }
  };

  const datePicker = <div className="date-picker"><button className="icon-button" aria-label="Previous day" onClick={() => changeDate(-1)}><ChevronLeft size={17}/></button><label className="date-label"><CalendarDays size={15}/><span>{dateLabel}</span><input aria-label="Choose a date" type="date" value={date} max={currentDate} onChange={(event) => { const val = event.target.value; if (val && val <= currentDate) setSelectedDate(val); }} /></label><button className="icon-button" aria-label="Next day" disabled={date >= currentDate} onClick={() => changeDate(1)}><ChevronRight size={17}/></button></div>;

  const progressPercent = targets.calorieTarget ? Math.min(100, Math.round(((totalCalories ?? 0) / targets.calorieTarget) * 100)) : 0;
  const remainingKcal = targets.calorieTarget - (totalCalories ?? 0);
  const proteinPercent = targets.proteinTarget ? Math.min(100, Math.round(((totalProtein ?? 0) / targets.proteinTarget) * 100)) : 0;
  const proteinRemaining = Math.max(0, Number((targets.proteinTarget - (totalProtein ?? 0)).toFixed(1)));
  const pendingDeleteOption = confirmDeleteMeal ? mealOptions.find((option) => option.id === confirmDeleteMeal) : null;
  const pendingDeleteCount = confirmDeleteMeal ? entries.filter((entry) => entry.meal === confirmDeleteMeal).length : 0;

  return (
    <motion.section className="page calorie-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={transition}>
      <PageHeader eyebrow={prettyDate(date, { weekday: 'long' })} title="Calories" subtitle="" right={datePicker} />

      <section className={`calorie-hero ${remainingKcal < 0 ? 'is-over' : ''}`} aria-label="Daily nutrition summary">
        <div className="calorie-energy-overview">
          <div className="calorie-energy-copy">
            <span className="energy-eyebrow">{remainingKcal < 0 ? 'Above goal' : 'Remaining'}</span>
            <strong>{Math.abs(remainingKcal).toLocaleString()}</strong>
            <span className="energy-remaining">kcal</span>
            <div className="calorie-goal-tag">Goal <b>{targets.calorieTarget.toLocaleString()} kcal</b></div>
          </div>
          <div className="energy-ring" role="progressbar" aria-label="Calorie goal progress" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${totalCalories ?? 0} of ${targets.calorieTarget} kcal`}>
            <svg viewBox="0 0 200 200" aria-hidden="true"><circle className="energy-ring-track" cx="100" cy="100" r="84"/><circle className="energy-ring-fill" cx="100" cy="100" r="84" strokeDasharray={527.788} strokeDashoffset={527.788 * (1 - progressPercent / 100)}/></svg>
            <div className="energy-ring-value"><span>{totalCalories?.toLocaleString() ?? '0'}</span><small>kcal eaten</small></div>
          </div>
        </div>
        <div className="calorie-sub-stats">
          <div className="calorie-sub-stat macro-protein">
            <small><i/>Protein</small><b>{totalProtein != null ? `${totalProtein}` : '—'}<em> g</em></b>
            {targets.proteinTarget > 0 && <div className="calorie-sub-track" aria-hidden="true"><span style={{ width: `${proteinPercent}%` }}/></div>}
            <span>{totalProtein == null ? `Goal ${targets.proteinTarget}g` : proteinRemaining > 0 ? `${proteinRemaining}g to goal` : 'Goal reached'}</span>
          </div>
          <div className="calorie-sub-stat macro-carbs"><small><i/>Carbs</small><b>{totalCarbs != null ? `${totalCarbs}` : '—'}<em> g</em></b></div>
          <div className="calorie-sub-stat macro-fat"><small><i/>Fat</small><b>{totalFat != null ? `${totalFat}` : '—'}<em> g</em></b></div>
        </div>
      </section>

      <button type="button" className="add-food-launch" aria-haspopup="dialog" onClick={() => setShowFoodSheet(true)}><Plus size={19}/><span>Add food</span></button>

      <section className="surface-card logged-food-card">
        <div className="logged-food-head">
          <div>
            <h3>Food log</h3>
            {entries.length > 0 && <p>{entries.length} {entries.length === 1 ? 'item' : 'items'} · {listedCalories.toLocaleString()} kcal</p>}
          </div>
        </div>

        <div className="meal-status-summary" aria-label="Meal check-ins">{mealOptions.filter((option) => option.trackerId).map((option) => <span key={option.id} className={day?.states[option.trackerId!] === 'done' ? 'is-done' : ''}>{day?.states[option.trackerId!] === 'done' ? <Check size={12} aria-hidden="true"/> : <i aria-hidden="true"/>}{option.label}<span className="meal-state-label">{day?.states[option.trackerId!] === 'done' ? ', eaten' : ', not logged'}</span></span>)}</div>
        {unitemizedCalories > 0 && <div className="unitemized-nutrition"><span>Saved without food details</span><b>{unitemizedCalories.toLocaleString()} kcal</b></div>}
        {entries.length === 0 ? (
          <p className="food-log-empty">No food logged.</p>
        ) : (
          <div className="meal-packs-container">
            {mealOptions.map((opt) => {
              const mealEntries = entries.filter((entry) => entry.meal === opt.id);
              if (mealEntries.length === 0) return null;

              const packKcal = mealEntries.reduce((sum, item) => sum + (item.calories || 0), 0);
              const packProtein = Number(mealEntries.reduce((sum, item) => sum + (item.protein ?? 0), 0).toFixed(1));
              const packCarbs = Number(mealEntries.reduce((sum, item) => sum + (item.carbs ?? 0), 0).toFixed(1));
              const packFat = Number(mealEntries.reduce((sum, item) => sum + (item.fat ?? 0), 0).toFixed(1));

              return (
                <div className="meal-pack-card" key={opt.id}>
                  <div className="meal-pack-header">
                    <div className="meal-pack-title-wrap">
                      <span className={`meal-pack-badge ${opt.id}`}>
                        {opt.label}
                      </span>
                    </div>
                    <div className="meal-pack-right">
                      <div className="meal-pack-subtotals">
                        <b>{packKcal.toLocaleString()} kcal</b>
                        <small>{packProtein}g P · {packCarbs}g C · {packFat}g F</small>
                      </div>
                      <button
                        type="button"
                        className="meal-pack-delete-btn"
                        title={`Delete entire ${opt.label} meal and its items`}
                        onClick={() => setConfirmDeleteMeal(opt.id)}
                      >
                        <Trash2 size={13} />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>

                  <div className="meal-pack-items">
                    {mealEntries.map((entry) => (
                      <div className="food-item-row" key={entry.id}>
                        <div className="food-item-meta">
                          <div className="food-item-title">
                            <b>{entry.name}</b>
                            {entry.portion && <small className="food-portion">({entry.portion})</small>}
                          </div>
                          <div className="food-item-macros">
                            {entry.protein != null ? `${entry.protein}g P` : '0g P'} · {entry.carbs != null ? `${entry.carbs}g C` : '0g C'} · {entry.fat != null ? `${entry.fat}g F` : '0g F'}
                          </div>
                        </div>
                        <div className="food-item-right">
                          <div className="food-item-kcal">
                            {entry.calories.toLocaleString()}<small>kcal</small>
                          </div>
                          <button
                            type="button"
                            className="food-remove"
                            aria-label={`Remove ${entry.name}`}
                            title="Remove item"
                            onClick={() => void removeFood(entry.id)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {createPortal(<div className="calorie-page calorie-sheet-portal"><AnimatePresence>{showFoodSheet && <motion.div className="food-sheet-backdrop" style={sheetViewport ? { height: sheetViewport.height, top: sheetViewport.top } : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget && !isLoggingMeal) setShowFoodSheet(false); }}>
        <motion.section ref={sheetRef} className="food-sheet" role="dialog" aria-modal="true" aria-labelledby="food-sheet-title" initial={{ y: 28 }} animate={{ y: 0 }} exit={{ y: 28 }} transition={{ type: 'spring', stiffness: 480, damping: 42 }}>
          <div className="food-sheet-header"><h2 id="food-sheet-title">Add food</h2><button type="button" className="food-sheet-close" aria-label="Close food logger" disabled={isLoggingMeal} onClick={() => setShowFoodSheet(false)}><X size={20}/></button></div>
<section className="calorie-input-card nutrition-log-card food-sheet-content">
        <div className="meal-picker-block">
          
          <div className="meal-pill-group" role="radiogroup" aria-label="Meal type">
            {mealOptions.map((opt) => {
              const isConsumed = opt.trackerId && day?.states[opt.trackerId] === 'done';
              const count = entries.filter((entry) => entry.meal === opt.id).length;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`meal-pill-btn ${selectedMeal === opt.id ? 'active' : ''}`}
                  onClick={() => setSelectedMeal(opt.id)}
                  role="radio"
                  aria-checked={selectedMeal === opt.id}
                >
                  {opt.label}
                  {count > 0 && <span className="meal-pill-count">{count}</span>}
                  {isConsumed && <span className="meal-consumed-tick" title="Marked as consumed">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="food-entry-toolbar">
          <div className="food-entry-modes" role="group" aria-label="Entry method">
            <button type="button" aria-pressed={!showManual} onClick={() => setShowManual(false)}><Sparkles size={14}/>AI estimate</button>
            <button type="button" aria-label="Add food manually" aria-pressed={showManual} onClick={() => setShowManual(true)}><Pencil size={14}/>Manual</button>
          </div>
          {currentTrackerId && (
            <button
              type="button"
              className={`subtle-button meal-status-toggle ${currentMealDone ? 'is-done' : ''}`}
              aria-pressed={currentMealDone}
              aria-label={currentMealDone ? `Mark ${currentOption.label} as not done` : `Mark ${currentOption.label} as done without logging food`}
              title={currentMealDone ? 'Mark this meal as not done' : 'Mark this meal as done without logging food'}
              onClick={async () => {
                try { await setStatus(currentTrackerId, currentMealDone ? 'unrecorded' : 'done'); }
                catch (error) { setAnalysisError(error instanceof Error ? error.message : 'Could not update this meal. Try again.'); }
              }}
            >
              {currentMealDone ? <><Check size={13}/>Eaten</> : 'Mark eaten'}
            </button>
          )}
        </div>
        {analysisError && <p className="ai-analysis-error" role="alert">{analysisError}</p>}
        {!showManual && <>
        <div className="food-description">
          <label htmlFor="food-description">Food or drink</label>
          <textarea
            id="food-description"
            maxLength={2000}
            placeholder="e.g. 2 eggs, toast and coffee"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void analyzeMeal();
              }
            }}
          />
          <small className="field-hint">Text and photos go to Google AI. Review estimates before saving.</small>
        </div>

        <div className="calorie-input-actions">
          <label className="ai-photo-button" title="Take a photo with camera">
            <Camera size={14} />
            <span>Camera</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                void selectPhoto(e.target.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <label className="ai-photo-button" title="Upload photo from gallery">
            <ImageIcon size={14} />
            <span>Gallery</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                void selectPhoto(e.target.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
          </label>
          
          <button
            type="button"
            className="primary-button calorie-estimate-btn"
            aria-label={analyzing ? 'Analyzing food' : 'Analyze food'}
            aria-busy={analyzing}
            disabled={analyzing || (!description.trim() && !photo)}
            onClick={() => void analyzeMeal()}
          >
            {analyzing ? <><span className="inline-spinner" aria-hidden="true"/>Analyzing…</> : <><Sparkles size={14} /> Analyze</>}
          </button>
        </div>

        {photo && (
          <div className="ai-photo-preview">
            <img src={photo.data} alt="Food preview" />
            <span>Photo attached</span>
            <button type="button" onClick={() => setPhoto(null)}>Remove photo</button>
          </div>
        )}

        {estimates && (
          <div className="ai-estimate-review">
            <div className="ai-estimate-head">
              <div>
                <b>Review estimate</b>
              </div>
              <label className="estimate-meal-picker">
                <span>Add to</span>
                <select
                  value={selectedMeal}
                  onChange={(e) => {
                    const newMeal = e.target.value as MealChoice;
                    setSelectedMeal(newMeal);
                    setEstimates((prev) => prev ? prev.map((item) => ({ ...item, meal: newMeal })) : null);
                  }}
                  className="manual-meal-select"
                >
                  {mealOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ai-estimate-list">
              {estimates.map((item) => (
                <div className="ai-estimate-item" key={item.id}>
                  <span className="ai-estimate-copy">
                    <strong>{item.name}</strong>
                    {item.portion && <small>{item.portion}</small>}
                  </span>
                  <span className="ai-estimate-macros">
                    <b>{item.calories} kcal</b>
                    {item.protein ?? 0}g P · {item.carbs ?? 0}g C · {item.fat ?? 0}g F
                  </span>
                  <button type="button" className="ai-estimate-remove" aria-label={`Remove ${item.name} from estimate`} title="Remove item" onClick={() => removeEstimate(item.id)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            {estimateNote && <small className="ai-estimate-note">{estimateNote}</small>}
            {estimateTotals && (
              <div className="ai-estimate-total">
                <span>{estimates.length} {estimates.length === 1 ? 'item' : 'items'}</span>
                <b>{estimateTotals.calories?.toLocaleString() ?? 0} kcal</b>
                <small>{estimateTotals.protein ?? 0}g P · {estimateTotals.carbs ?? 0}g C · {estimateTotals.fat ?? 0}g F</small>
              </div>
            )}
            <button
              type="button"
              className="primary-button full-button"
              disabled={isLoggingMeal}
              onClick={() => void confirmLogAiMeal()}
            >
              {isLoggingMeal ? <span className="inline-spinner" aria-hidden="true"/> : <Check size={15}/>}
              {isLoggingMeal ? 'Saving…' : currentOption.trackerId ? `Log ${estimates.length} ${estimates.length === 1 ? 'item' : 'items'} to ${currentOption.label}` : `Log ${estimates.length} ${estimates.length === 1 ? 'item' : 'items'} as Extra`}
            </button>
          </div>
        )}

        </>}
        <div className="manual-entry-block">
          {showManual && (
            <>
              <form className="manual-form-grid" onSubmit={(e) => void handleManualAdd(e)}>
                <label className="manual-name-field">
                  <span>Food name</span>
                  <input
                    required
                    autoFocus
                    placeholder="e.g. Oatmeal"
                    value={manualName}
                    maxLength={80}
                    onChange={(e) => setManualName(e.target.value)}
                  />
                </label>
                <label>
                  <span>Calories</span>
                  <input
                    required
                    type="number"
                    min="0"
                    max="20000"
                    inputMode="decimal"
                    placeholder="kcal"
                    value={manualKcal}
                    onChange={(e) => setManualKcal(e.target.value)}
                  />
                </label>
                <label>
                  <span>Protein (g)</span>
                  <input
                    type="number"
                    min="0"
                    max="2000"
                    inputMode="decimal"
                    step="0.1"
                    placeholder="0"
                    value={manualProtein}
                    onChange={(e) => setManualProtein(e.target.value)}
                  />
                </label>
                <label>
                  <span>Carbs (g)</span>
                  <input
                    type="number"
                    min="0"
                    max="5000"
                    inputMode="decimal"
                    step="0.1"
                    placeholder="0"
                    value={manualCarbs}
                    onChange={(e) => setManualCarbs(e.target.value)}
                  />
                </label>
                <label>
                  <span>Fat (g)</span>
                  <input
                    type="number"
                    min="0"
                    max="2000"
                    inputMode="decimal"
                    step="0.1"
                    placeholder="0"
                    value={manualFat}
                    onChange={(e) => setManualFat(e.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="secondary-button"
                  disabled={isLoggingMeal || !manualName.trim() || manualKcal === ''}
                >
                  {isLoggingMeal ? <><span className="inline-spinner" aria-hidden="true"/>Saving…</> : 'Add food'}
                </button>
              </form>
              <small className="manual-form-note">Macros are optional.</small>
            </>
          )}
        </div>
      </section>
        </motion.section>
      </motion.div>}</AnimatePresence></div>, document.body)}

      <AnimatePresence>
        {confirmDeleteMeal && pendingDeleteOption && (
          <ConfirmDialog
            title={`Delete ${pendingDeleteOption.label}?`}
            message={`This removes ${pendingDeleteCount} ${pendingDeleteCount === 1 ? 'item' : 'items'} from ${isToday ? 'today' : 'this day'}. ${pendingDeleteOption.trackerId ? 'The meal habit will be marked unrecorded.' : 'The calories will be removed from this day.'}`}
            cancelLabel="Keep meal"
            confirmLabel="Delete meal"
            onCancel={() => setConfirmDeleteMeal(null)}
            onConfirm={() => deleteMeal(confirmDeleteMeal)}
          />
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function InsightsPage({ days, weights, trackers, preferences }: { days: DayRecord[]; weights: WeightEntry[]; trackers: Tracker[]; preferences: Preferences }) {
  const [showAllRates, setShowAllRates] = useState(false);
  const [insightView, setInsightView] = useState<'overview' | 'habits' | 'body'>('overview');
  const [scoreHistoryOpen, setScoreHistoryOpen] = useState(false);
  const [period, setPeriod] = useState<'7' | '30' | '90' | 'all'>('all');
  const latest = weights.at(-1);
  const startDate = period === 'all' ? weights[0]?.date ?? addCalendarDays(localDateKey(), -30) : addCalendarDays(localDateKey(), -(Number(period) - 1));
  const visibleWeights = weights.filter((entry) => entry.date >= startDate && entry.date <= localDateKey());
  const change = visibleWeights.length > 1 ? Number((asDisplayWeight(visibleWeights.at(-1)!.kg, preferences.weightUnit) - asDisplayWeight(visibleWeights[0].kg, preferences.weightUnit)).toFixed(1)) : null;
  const weightEntries = visibleWeights.map((entry) => ({ date: shortDate(entry.date), value: asDisplayWeight(entry.kg, preferences.weightUnit), fullDate: entry.date }));
  const currentStart = addCalendarDays(localDateKey(), -6);
  const previousStart = addCalendarDays(localDateKey(), -13);
  const learningSummary = summarizeLearning(days, trackers, preferences, currentStart, localDateKey());
  const previousLearningEnd = addCalendarDays(currentStart, -1);
  const previousLearningStart = addCalendarDays(previousLearningEnd, -6);
  const previousLearningSummary = summarizeLearning(days, trackers, preferences, previousLearningStart, previousLearningEnd);
  const thisWeekStart = mondayWeekStart(localDateKey());
  const weeklyReflection = useLiveQuery(() => db.weeklyReflections.get(thisWeekStart), [thisWeekStart]);
  const [whatWorkedText, setWhatWorkedText] = useState(weeklyReflection?.whatWorked ?? '');
  const [whatCouldBeEasierText, setWhatCouldBeEasierText] = useState(weeklyReflection?.whatCouldBeEasier ?? '');
  useEffect(() => {
    setWhatWorkedText(weeklyReflection?.whatWorked ?? '');
    setWhatCouldBeEasierText(weeklyReflection?.whatCouldBeEasier ?? '');
  }, [weeklyReflection?.whatWorked, weeklyReflection?.whatCouldBeEasier]);

  const saveReflections = async (override?: { whatWorked?: string; whatCouldBeEasier?: string }) => {
    const worked = override && 'whatWorked' in override ? override.whatWorked : whatWorkedText;
    const easier = override && 'whatCouldBeEasier' in override ? override.whatCouldBeEasier : whatCouldBeEasierText;
    await saveWeeklyReflection(thisWeekStart, {
      whatWorked: worked?.trim() || undefined,
      whatCouldBeEasier: easier?.trim() || undefined,
    });
  };

  const nutritionDays = period === 'all' ? days : days.filter((day) => day.date >= addCalendarDays(localDateKey(), -(Number(period) - 1)) && day.date <= localDateKey());
  const nutritionSummary = nutritionIntakeSummary(nutritionDays, preferences);
  const { current, previous } = scorePair(days, trackers, currentStart, previousStart, preferences);
  const scoreDelta = current.score != null && previous.score != null ? current.score - previous.score : null;
  const weightDates = new Set(weights.map((entry) => entry.date));
  const rates = trackers.filter((tracker) => Array.from({ length: 7 }, (_, offset) => addCalendarDays(currentStart, offset)).some((date) => trackerEligibleOnDate(tracker, date))).map((tracker) => { const entries = days.filter((d) => d.date >= currentStart && d.date <= localDateKey() && trackerEligibleOnDate(tracker, d.date)).map((d) => trackerState(d, tracker.id, preferences, tracker.id === 'weight' && weightDates.has(d.date))).filter((value) => value !== 'unrecorded'); const done = entries.filter((value) => value === 'done').length; return { tracker, done, total: entries.length, rate: entries.length ? Math.round(done / entries.length * 100) : null }; }).filter((item) => item.total > 0).sort((a,b) => (b.rate ?? 0) - (a.rate ?? 0));
  const streakRows = trackers.filter((tracker) => !tracker.archived && ['reading','communication','bath'].includes(tracker.id) || !tracker.builtin && !tracker.archived).map((tracker) => ({ tracker, streak: dailyStreak(days, tracker) }));
  const workoutTracker = trackers.find((tracker) => tracker.id === 'workout');
  const workoutStreak = workoutTracker ? weeklyStreak(days, workoutTracker, preferences.weeklyGoals?.workout ?? 3) : null;
  const weeklyScores = weeklyScoreHistory(days, trackers, preferences);
  const trackedDayCount = days.filter((day) => day.date >= currentStart && day.date <= localDateKey() && hasTrackedAction(day)).length;
  const scoredWeekCount = weeklyScores.filter((item) => item.score != null).length;
  const insightTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'habits', label: 'Habits' },
    { id: 'body', label: 'Body' },
  ] as const;

  return <motion.section className="page insights-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={transition}>
    <PageHeader eyebrow="" title="Insights" subtitle=""/>
    <div className="insight-tabs" role="tablist" aria-label="Insights sections">
      {insightTabs.map((tab, index) => <button
        key={tab.id}
        id={`insight-tab-${tab.id}`}
        role="tab"
        aria-selected={insightView === tab.id}
        aria-controls={`insight-panel-${tab.id}`}
        tabIndex={insightView === tab.id ? 0 : -1}
        onClick={() => setInsightView(tab.id)}
        onKeyDown={(event) => {
          const keys: Record<string, number> = { ArrowRight: (index + 1) % insightTabs.length, ArrowLeft: (index + insightTabs.length - 1) % insightTabs.length, Home: 0, End: insightTabs.length - 1 };
          const next = keys[event.key];
          if (next == null) return;
          event.preventDefault();
          setInsightView(insightTabs[next].id);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}
      >{tab.label}</button>)}
    </div>

    <motion.div className="insight-panel" key={insightView} role="tabpanel" id={`insight-panel-${insightView}`} aria-labelledby={`insight-tab-${insightView}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .16 }}>
      {insightView === 'overview' && <>
        <section className="insight-score-overview" aria-labelledby="weekly-score-title">
          <div className="insight-score-top">
            <div className="insight-score-copy"><span className="card-kicker">Past 7 days</span><h2 id="weekly-score-title">Weekly score</h2>{scoreDelta != null && <span className={`score-delta ${scoreDelta >= 0 ? 'positive' : 'negative'}`}>{scoreDelta >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownLeft size={14}/>} {Math.abs(scoreDelta)} pts</span>}</div>
            <ProgressRing value={current.score} label="Seven-day score" caption={current.score == null ? 'NO DATA' : '7 DAYS'}/>
          </div>
          <div className="insight-score-metrics"><div><b>{current.done}</b><span>Complete</span></div><div><b>{current.missed}</b><span>Incomplete</span></div><div><b>{trackedDayCount}<small> / 7</small></b><span>Tracked days</span></div></div>
          <div className="score-coverage"><div><span>Logging coverage</span><b>{current.coverage}%</b></div><div className="progress-bar"><span style={{ width: `${current.coverage}%` }}/></div></div>
        </section>

        {(learningSummary.days > 0 || previousLearningSummary.days > 0) && <section className="insight-learning" aria-labelledby="learning-title"><span className="insight-row-icon"><BookOpen size={19}/></span><div><h2 id="learning-title">Learning</h2><span>{learningSummary.days} {learningSummary.days === 1 ? 'day' : 'days'}</span></div><div className="insight-learning-total"><strong>{learningSummary.minutes}<small> min</small></strong>{previousLearningSummary.days > 0 && learningSummary.minutes !== previousLearningSummary.minutes && <span>{learningSummary.minutes - previousLearningSummary.minutes >= 0 ? '+' : ''}{learningSummary.minutes - previousLearningSummary.minutes} min vs previous 7d</span>}</div></section>}

        <details className="weekly-reflection insight-reflection"><summary><span className="weekly-reflection-mark"><Sparkles size={17}/></span><span className="weekly-reflection-heading"><strong>Weekly reflection</strong></span><ChevronDown size={16}/></summary><div className="weekly-reflection-fields"><label><span>What worked?</span><textarea aria-label="What felt good this week?" maxLength={400} value={whatWorkedText} onChange={(event) => setWhatWorkedText(event.target.value)} onBlur={() => void saveReflections()}/></label><label><span>Next week?</span><textarea aria-label="One small change for next week" maxLength={400} value={whatCouldBeEasierText} onChange={(event) => setWhatCouldBeEasierText(event.target.value)} onBlur={() => void saveReflections()}/></label></div></details>

        <details className="insight-disclosure insight-score-history" onToggle={(event) => setScoreHistoryOpen(event.currentTarget.open)}><summary><span className="insight-row-icon"><ChartNoAxesColumnIncreasing size={18}/></span><strong>Score history</strong><ChevronDown size={16}/></summary>{scoreHistoryOpen && (scoredWeekCount ? <div className="chart-wrap"><Suspense fallback={<ChartLoading/>}><ScoreHistoryChart scores={weeklyScores}/></Suspense></div> : <div className="chart-empty compact-empty"><h3>No score history</h3></div>)}</details>

        <details className="scoring-note insight-about-score"><summary><CircleHelp size={16}/>About this score<ChevronDown size={14}/></summary><p>Completed habit weight ÷ scored habit weight × 100. On days with tracked activity, unchecked habits count as missed. Days without tracked activity stay outside the score. Nutrition contributes when both calories and protein are entered. Custom habits share a 15-point weight pool.</p></details>
      </>}

      {insightView === 'habits' && <>
        <section className="insight-completion" aria-labelledby="completion-title"><div className="insight-section-heading"><h2 id="completion-title">Completion rate</h2><span>Past 7 days</span></div>{rates.length ? <div className="rate-list">{(showAllRates ? rates : rates.slice(0, 4)).map(({ tracker, rate, done, total }) => { const Icon = iconMap[tracker.icon] ?? Sparkles; return <div className="rate-row" key={tracker.id}><div className="rate-title"><span style={{ '--tracker-color': tracker.color } as React.CSSProperties}><Icon size={16}/></span><b>{tracker.name}</b><small>{done}/{total}</small></div><div className="rate-track"><span style={{ width: `${rate}%`, background: tracker.color }}/></div><strong>{rate}%</strong></div>; })}</div> : <div className="chart-empty compact-empty"><h3>No check-ins yet</h3></div>}{rates.length > 4 && <button className="show-all-rates" aria-expanded={showAllRates} onClick={() => setShowAllRates(!showAllRates)}>{showAllRates ? 'Show less' : `Show all ${rates.length} habits`}<ChevronDown size={15}/></button>}</section>

        <details className="insight-disclosure insight-streaks"><summary><span className="insight-row-icon"><Activity size={18}/></span><strong>Streaks</strong><ChevronDown size={16}/></summary><div className="streak-list">{streakRows.map(({ tracker, streak }) => <div className="streak-item" key={tracker.id}><span style={{ '--tracker-color': tracker.color } as React.CSSProperties}>{createElement(iconMap[tracker.icon] ?? Sparkles, { size: 16 })}</span><b>{tracker.name}</b><small>{streak.thisWeek} in 7d</small><strong>{streak.current}<em>day streak</em></strong>{streak.best > streak.current && <span className="streak-best">Best {streak.best}</span>}</div>)}{workoutStreak && <div className="streak-item weekly-streak-item"><span style={{ '--tracker-color': '#96b9a6' } as React.CSSProperties}><Dumbbell size={16}/></span><b>Movement goal</b><small>{workoutStreak.done}/{workoutStreak.goal} this week{workoutStreak.unknown ? ` · ${workoutStreak.unknown} unrecorded` : ''}</small><strong>{workoutStreak.current}<em>week streak</em></strong>{workoutStreak.best > workoutStreak.current && <span className="streak-best">Best {workoutStreak.best}</span>}</div>}</div></details>
      </>}

      {insightView === 'body' && <>
        <div className="insight-range"><span>Weight & nutrition</span><div className="segmented-control" role="group" aria-label="Body data range">{(['7','30','90','all'] as const).map((value) => <button aria-pressed={period === value} className={period === value ? 'active' : ''} key={value} onClick={() => setPeriod(value)}>{value === 'all' ? 'All' : `${value}d`}</button>)}</div></div>
        <section className="insight-weight" aria-labelledby="weight-trend-title"><div className="insight-weight-heading"><div><span className="card-kicker">{latest ? 'Latest measurement' : 'Measurements'}</span><h2 id="weight-trend-title">Weight trend</h2></div>{latest && <span className="insight-weight-date">{prettyDate(latest.date, { month: 'short', day: 'numeric' })}</span>}</div>{latest && <div className="insight-weight-value"><strong>{asDisplayWeight(latest.kg, preferences.weightUnit)}<small> {preferences.weightUnit}</small></strong><span className={`weight-change ${change == null ? '' : change <= 0 ? 'positive' : 'negative'}`}>{change == null ? (visibleWeights.length === 1 ? 'One entry in this range' : 'No change to compare') : `${change > 0 ? '+' : ''}${change} ${preferences.weightUnit} in this range`}</span></div>}
          {weightEntries.length > 1 ? <div className="chart-wrap"><svg className="weight-chart" viewBox="0 0 360 200" preserveAspectRatio="none" role="img" aria-label="Weight measurements over time"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".2"/><stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs>{[0,1,2,3].map((index) => { const maxVal = Math.max(...weightEntries.map((x) => x.value)); const minVal = Math.min(...weightEntries.map((x) => x.value)); const axisVal = (maxVal - (maxVal - minVal) * index / 3).toFixed(1); return <g key={index}><line x1="34" x2="350" y1={20 + index * 45} y2={20 + index * 45} className="chart-gridline"/><text x="0" y={24 + index * 45} className="chart-axis-label">{axisVal}</text></g>; })}<polyline points={chartPoints(weightEntries.map((item) => item.value))} className="chart-line" pathLength="1"/><polygon points={`34,175 ${chartPoints(weightEntries.map((item) => item.value))} 350,175`} className="chart-area"/>{chartPointsArray(weightEntries.map((item) => item.value)).map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r="8" className="chart-hit"/><circle cx={point.x} cy={point.y} r="4" className="chart-point"/><title>{weightEntries[index].fullDate}: {weightEntries[index].value} {preferences.weightUnit}</title></g>)}</svg><div className="chart-dates"><span>{prettyDate(weightEntries[0].fullDate, { month: 'short', day: 'numeric' })}</span><span>{prettyDate(weightEntries.at(-1)!.fullDate, { month: 'short', day: 'numeric' })}</span></div></div> : <div className="chart-empty"><div className="empty-orbit"><Scale size={22}/></div><h3>{weightEntries.length ? 'One weight entry' : latest ? 'No entries in this range' : 'No weight entries'}</h3><p>{weightEntries.length ? 'Add a second measurement to see a trend.' : latest ? 'Choose a longer range to see earlier measurements.' : 'Log weight on Today.'}</p></div>}
        </section>
        <section className="insight-body-nutrition" aria-labelledby="nutrition-title"><div className="insight-section-heading"><h2 id="nutrition-title">Nutrition</h2><span>{period === 'all' ? 'All time' : `Last ${period} days`}</span></div>{nutritionSummary.recorded ? <><div className="insight-nutrition-target"><strong>{nutritionSummary.onTarget}<small> / {nutritionSummary.recorded}</small></strong><span>days within target</span></div><div className="nutrition-insight-bar"><span style={{ width: `${Math.round(nutritionSummary.onTarget / nutritionSummary.recorded * 100)}%` }}/></div><div className="insight-nutrition-averages"><div><b>{nutritionSummary.averageCalories?.toLocaleString()}<small> kcal</small></b><span>Daily average</span></div><div><b>{nutritionSummary.averageProtein}<small> g</small></b><span>Protein average</span></div></div></> : <div className="nutrition-insight-empty">Log food in Calories to see your pattern.</div>}</section>
      </>}
    </motion.div>
  </motion.section>;
}

function scorePair(days: DayRecord[], trackers: Tracker[], currentStart: string, previousStart: string, preferences: Preferences) {
  return {
    current: scorePeriod(days, trackers, preferences, currentStart),
    previous: scorePeriod(days, trackers, preferences, previousStart),
  };
}

function chartPointsArray(values: number[]) {
  const min = Math.min(...values) - .5, max = Math.max(...values) + .5, span = max - min || 1;
  return values.map((value, index) => ({ x: values.length === 1 ? 192 : 34 + index * (316 / (values.length - 1)), y: 160 - ((value - min) / span) * 130 }));
}
function chartPoints(values: number[]) { return chartPointsArray(values).map(({ x, y }) => `${x},${y}`).join(' '); }

function MorePage({ trackers, preferences, pending, installReady, isInstalled, onInstall, onSavePreferences, onSaveTracker, onToast, updatePanel }: { trackers: Tracker[]; preferences: Preferences; pending: number; installReady: boolean; isInstalled: boolean; onInstall: () => Promise<void>; onSavePreferences: (preferences: Preferences) => Promise<void>; onSaveTracker: (tracker: Tracker) => Promise<void>; onToast: (message: string) => void; updatePanel: React.ReactNode }) {
  const [newHabit, setNewHabit] = useState('');
  const [importing, setImporting] = useState(false);
  const [restorePending, setRestorePending] = useState<ReturnType<typeof parseMinimaBackup> | null>(null);
  const [lastBackupGeneratedAt, setLastBackupGeneratedAt] = useState<number | null>(() => {
    try { const value = Number(localStorage.getItem('minima:last-backup-generated')); return Number.isFinite(value) && value > 0 ? value : null; }
    catch { return null; }
  });
  const [weightGoalText, setWeightGoalText] = useState(() => preferences.weightGoalKg == null ? '' : String(asDisplayWeight(preferences.weightGoalKg, preferences.weightUnit)));
  const [calorieTargetText, setCalorieTargetText] = useState(() => String(preferences.calorieTarget));
  const [proteinTargetText, setProteinTargetText] = useState(() => String(preferences.proteinTarget));
  const [weeklyGoalText, setWeeklyGoalText] = useState(() => String(preferences.weeklyGoals?.workout ?? 3));
  const [scoreWeightTexts, setScoreWeightTexts] = useState<Record<string, string>>(() => Object.fromEntries(trackers.map((tracker) => [tracker.id, String(preferences.trackerWeights[tracker.id] ?? tracker.weight)])));
  const fileInputId = 'backup-import';
  useEffect(() => { setWeightGoalText(preferences.weightGoalKg == null ? '' : String(asDisplayWeight(preferences.weightGoalKg, preferences.weightUnit))); }, [preferences.weightGoalKg, preferences.weightUnit]);
  useEffect(() => { setCalorieTargetText(String(preferences.calorieTarget)); setProteinTargetText(String(preferences.proteinTarget)); }, [preferences.calorieTarget, preferences.proteinTarget]);
  useEffect(() => { setWeeklyGoalText(String(preferences.weeklyGoals?.workout ?? 3)); }, [preferences.weeklyGoals?.workout]);
  useEffect(() => { setScoreWeightTexts(Object.fromEntries(trackers.map((tracker) => [tracker.id, String(preferences.trackerWeights[tracker.id] ?? tracker.weight)]))); }, [trackers, preferences.trackerWeights]);
  const orderedTrackers = sortTrackersForSettings(trackers);
  const save = async (change: Partial<Preferences>) => {
    const next: Preferences = { ...preferences, ...change };
    if (next.calorieTarget !== preferences.calorieTarget || next.proteinTarget !== preferences.proteinTarget) {
      const today = localDateKey();
      const history = [...(preferences.nutritionTargetHistory ?? [{ effectiveDate: (await db.days.orderBy('date').first())?.date ?? today, calorieTarget: preferences.calorieTarget, proteinTarget: preferences.proteinTarget }])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
      const version = { effectiveDate: today, calorieTarget: next.calorieTarget, proteinTarget: next.proteinTarget };
      const existingIndex = history.findIndex((item) => item.effectiveDate === today);
      if (existingIndex >= 0) history[existingIndex] = version;
      else history.push(version);
      next.nutritionTargetHistory = history;
    }
    await onSavePreferences(next);
  };
  const saveWeightGoal = async () => {
    if (!weightGoalText.trim()) { await save({ weightGoalKg: undefined }); return; }
    const value = Number(weightGoalText);
    const kg = asStoredKg(value, preferences.weightUnit);
    if (!Number.isFinite(value) || kg < 25 || kg > 350) {
      setWeightGoalText(preferences.weightGoalKg == null ? '' : String(asDisplayWeight(preferences.weightGoalKg, preferences.weightUnit)));
      onToast('Use a weight within range');
      return;
    }
    await save({ weightGoalKg: Number(kg.toFixed(3)) });
  };
  const saveNutritionTargets = async () => {
    const calories = Number(calorieTargetText), protein = Number(proteinTargetText);
    if (!Number.isFinite(calories) || calories < 500 || calories > 10000 || !Number.isFinite(protein) || protein < 10 || protein > 500) {
      setCalorieTargetText(String(preferences.calorieTarget));
      setProteinTargetText(String(preferences.proteinTarget));
      onToast('Check your daily targets');
      return;
    }
    await save({ calorieTarget: calories, proteinTarget: protein });
  };
  const saveWeeklyGoal = async () => {
    const value = Number(weeklyGoalText);
    if (!Number.isInteger(value) || value < 1 || value > 7) {
      setWeeklyGoalText(String(preferences.weeklyGoals?.workout ?? 3));
      onToast('Choose 1–7 days');
      return;
    }
    await save({ weeklyGoals: { ...preferences.weeklyGoals, workout: value } });
  };
  const exportData = async () => {
    let url = '';
    try {
      const backup = await db.transaction('r', [db.days, db.trackers, db.weights, db.journals, db.weeklyReflections, db.preferences], async () => {
        const [days, savedTrackers, weights, journals, weeklyReflections, preferencesRow] = await Promise.all([
          db.days.toArray(), db.trackers.toArray(), db.weights.toArray(), db.journals.toArray(), db.weeklyReflections.toArray(), db.preferences.get('main'),
        ]);
        return { format: 'minima-backup', version: 1, exportedAt: new Date().toISOString(), days, trackers: savedTrackers, weights, journals, weeklyReflections, preferences: preferencesRow?.value };
      });
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `minima-backup-${localDateKey()}.json`;
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      const generatedAt = Date.now();
      setLastBackupGeneratedAt(generatedAt);
      try { localStorage.setItem('minima:last-backup-generated', String(generatedAt)); } catch { /* Backup download remains available if browser storage is restricted. */ }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onToast('Backup download started');
    } catch {
      if (url) URL.revokeObjectURL(url);
      onToast('Could not export backup');
    }
  };
  const restoreBackup = async (parsed: ReturnType<typeof parseMinimaBackup>) => {
    setImporting(true);
    try {
      const restoredTrackers = parsed.trackers.map((tracker) => {
        if (tracker.builtin || tracker.createdAt) return tracker;
        const firstUse = parsed.days.find((day) => day.states?.[tracker.id] === 'done' || day.states?.[tracker.id] === 'missed')?.date;
        return { ...tracker, createdAt: firstUse ?? localDateKey() };
      });
      await db.transaction('rw', [db.days, db.trackers, db.weights, db.journals, db.weeklyReflections, db.preferences], async () => {
        await db.days.bulkPut(parsed.days); await db.trackers.bulkPut(restoredTrackers); await db.weights.bulkPut(parsed.weights); await db.journals.bulkPut(parsed.journals);
        if (parsed.weeklyReflections) await db.weeklyReflections.bulkPut(parsed.weeklyReflections);
        if (parsed.preferences) await db.preferences.put({ id: 'main', value: parsed.preferences });
      });
      setRestorePending(null);
      onToast('Backup restored');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not restore this backup.'); }
    finally { setImporting(false); }
  };
  const importData = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    try {
      setRestorePending(parseMinimaBackup(await file.text()));
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not read this backup.'); }
    finally { setImporting(false); }
  };
  const addHabit = async () => { const name = newHabit.trim(); if (!name) return; const tracker: Tracker = { id: crypto.randomUUID(), name, group: 'Your habits', icon: 'sparkles', weight: 5, color: preferences.accent, archived: false, builtin: false, schedule: [0,1,2,3,4,5,6], createdAt: localDateKey() }; await onSaveTracker(tracker); setNewHabit(''); };
  const toggleArchive = async (tracker: Tracker) => {
    const archived = !tracker.archived;
    const today = localDateKey();
    const history = [...(tracker.archiveHistory ?? [])];
    const existingIndex = history.findIndex((h) => h.effectiveDate === today);
    if (existingIndex >= 0) {
      history[existingIndex] = { effectiveDate: today, archived };
    } else {
      history.push({ effectiveDate: today, archived });
    }
    await onSaveTracker({
      ...tracker,
      archived,
      archivedAt: archived ? today : undefined,
      archiveHistory: history,
    });
  };
  const updateWeight = async (tracker: Tracker, weight: number) => {
    const nextWeights = { ...preferences.trackerWeights, [tracker.id]: Math.max(0, Math.min(100, weight)) };
    const today = localDateKey();
    const history = [...(preferences.scoreWeightHistory ?? [])];
    if (!history.length) history.push({ effectiveDate: (await db.days.orderBy('date').first())?.date ?? today, weights: preferences.trackerWeights });
    const last = history.at(-1);
    if (last?.effectiveDate === today) history[history.length - 1] = { effectiveDate: today, weights: nextWeights };
    else history.push({ effectiveDate: today, weights: nextWeights });
    await save({ trackerWeights: nextWeights, scoreWeightHistory: history });
  };
  const saveScoreWeight = async (tracker: Tracker) => {
    const raw = scoreWeightTexts[tracker.id] ?? '';
    const value = Number(raw);
    const currentWeight = preferences.trackerWeights[tracker.id] ?? tracker.weight;
    if (raw.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100) {
      setScoreWeightTexts((current) => ({ ...current, [tracker.id]: String(currentWeight) }));
      onToast('Use a score weight between 0 and 100');
      return;
    }
    const normalized = Number(value.toFixed(1));
    if (normalized === currentWeight) return;
    await updateWeight(tracker, normalized);
  };

  return <motion.section className="page settings-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={transition}>
    <PageHeader eyebrow="" title="Settings" subtitle=""/>
    <div className="settings-layout"><div className="settings-main">
      <details open className="surface-card settings-section"><summary className="settings-summary"><div className="settings-heading"><div><div className="card-kicker">PERSONALISE</div><h2>Appearance</h2></div><div className="settings-icon"><Sparkles size={18}/></div></div></summary><div className="theme-options">{([{ id: 'midnight', title: 'Midnight', description: 'Warm surfaces', swatches: ['#161713','#c6e18b'] }, { id: 'graphite', title: 'Graphite', description: 'Cool surfaces', swatches: ['#14171b','#9cc6ed'] }, { id: 'amoled', title: 'AMOLED', description: 'Black surfaces', swatches: ['#080909','#a9dfa9'] }] as const).map((theme) => <button key={theme.id} className={`theme-choice ${preferences.theme === theme.id ? 'selected' : ''}`} onClick={() => save({ theme: theme.id, accent: theme.id === 'graphite' ? '#9cc6ed' : theme.id === 'amoled' ? '#a9dfa9' : '#c6e18b' })}><span className="theme-swatch" style={{ background: theme.swatches[0] }}><i style={{ background: theme.swatches[1] }}/></span><b>{theme.title}</b>{preferences.theme === theme.id && <Check size={14} className="theme-check"/>}</button>)}</div><div className="accent-row"><div><b>Accent color</b></div><div className="accent-picker">{['#c6e18b','#dfa6b5','#9cc6ed','#e8bd77','#c09ed2','#8ed2c4'].map((color) => <button key={color} style={{ '--swatch': color } as React.CSSProperties} className={preferences.accent === color ? 'selected' : ''} aria-label={`Accent ${color}`} onClick={() => save({ accent: color })}/>)}</div></div></details>

      <details className="surface-card settings-section"><summary className="settings-summary"><div className="settings-heading"><div><div className="card-kicker">YOUR EVERYDAY</div><h2>Your habits</h2></div><div className="settings-icon green"><Leaf size={18}/></div></div></summary><div className="tracker-columns"><span>Habit</span><span>Weight</span><span>Show</span></div><div className="settings-trackers">{orderedTrackers.map((tracker) => <div className={`settings-tracker ${tracker.archived ? 'archived' : ''}`} key={tracker.id}><span className="tracker-mini-icon" style={{ '--tracker-color': tracker.color } as React.CSSProperties}>{createElement(iconMap[tracker.icon] ?? Sparkles, { size: 15 })}</span><span className="settings-tracker-name"><b>{tracker.name}</b></span><label className="score-weight"><input aria-label={`${tracker.name} score weight`} type="number" min="0" max="100" step="1" value={scoreWeightTexts[tracker.id] ?? ''} onChange={(event) => { const value = event.target.value; setScoreWeightTexts((current) => ({ ...current, [tracker.id]: value })); }} onBlur={() => void saveScoreWeight(tracker)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}/><span>pts</span></label><label className="switch"><input type="checkbox" checked={!tracker.archived} onChange={() => toggleArchive(tracker)}/><span/></label></div>)}</div><div className="add-habit"><input aria-label="New habit name" placeholder="Habit name" value={newHabit} maxLength={40} onChange={(event) => setNewHabit(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addHabit()}/><button className="secondary-button" onClick={addHabit} disabled={!newHabit.trim()}><Plus size={15}/> Add</button></div></details>

      <details className="surface-card settings-section"><summary className="settings-summary"><div className="settings-heading"><div><div className="card-kicker">BODY, YOUR WAY</div><h2>Weight units</h2></div><div className="settings-icon blue"><Scale size={18}/></div></div></summary><label className="unit-choice"><span>Display unit</span><select value={preferences.weightUnit} onChange={(event) => save({ weightUnit: event.target.value as Preferences['weightUnit'] })}><option value="kg">Kilograms (kg)</option><option value="lb">Pounds (lb)</option></select></label></details>

      <details className="surface-card settings-section"><summary className="settings-summary"><div className="settings-heading"><div><div className="card-kicker">AIM FOR HOW YOU FEEL</div><h2>Nutrition goals</h2></div><div className="settings-icon amber"><Apple size={18}/></div></div></summary><div className="goal-input-row"><label><span>Calorie target</span><div className="number-input"><input type="number" min="500" max="10000" step="50" value={calorieTargetText} onChange={(event) => setCalorieTargetText(event.target.value)} onBlur={saveNutritionTargets}/><small>kcal</small></div></label><label><span>Protein target</span><div className="number-input"><input type="number" min="10" max="500" step="5" value={proteinTargetText} onChange={(event) => setProteinTargetText(event.target.value)} onBlur={saveNutritionTargets}/><small>g</small></div></label></div></details>

      <details className="surface-card settings-section"><summary className="settings-summary"><div className="settings-heading"><div><div className="card-kicker">YOUR DATA, YOURS TO KEEP</div><h2>Backup & restore</h2></div><div className="settings-icon blue"><FileDown size={18}/></div></div></summary><div className="backup-actions"><button className="secondary-button" onClick={exportData}><FileDown size={15}/> Export backup</button><label htmlFor={fileInputId} className={`secondary-button ${importing ? 'disabled' : ''}`}>Restore backup<input id={fileInputId} type="file" accept="application/json,.json" hidden disabled={importing} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void importData(file); }}/></label></div><p className="privacy-foot"><Heart size={13}/> Export a backup to move or recover your data.</p></details>
    </div><aside className="settings-aside"><InstallCard installReady={installReady} isInstalled={isInstalled} onInstall={onInstall}/></aside></div>
    {updatePanel}
    <AnimatePresence>{restorePending && <ConfirmDialog title="Restore this backup?" message={`Merge ${restorePending.days.length} days and ${restorePending.weights.length} weight entries into this device? Existing records with matching dates will be replaced.`} cancelLabel="Cancel" confirmLabel="Restore" onCancel={() => setRestorePending(null)} onConfirm={() => restoreBackup(restorePending)} />}</AnimatePresence>
  </motion.section>;
}


