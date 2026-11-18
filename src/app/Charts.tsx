import { useReducedMotion } from 'framer-motion';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { prettyDate, shortDate } from '../lib/dates';
import type { Preferences } from '../lib/types';

export function WeightChart({ entries, unit }: { entries: { date: string; value: number | null }[]; unit: Preferences['weightUnit'] }) {
  const reduceMotion = useReducedMotion();
  return <ResponsiveContainer width="100%" height={230}>
    <LineChart data={entries} margin={{ top: 8, right: 8, left: 0, bottom: 2 }}>
      <CartesianGrid stroke="#ffffff0b" vertical={false}/>
      <XAxis dataKey="date" tickFormatter={(value: string) => shortDate(value)} minTickGap={28} tick={{ fill: '#929297', fontSize: 11 }} axisLine={false} tickLine={false}/>
      <YAxis width={42} domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: '#929297', fontSize: 11 }} axisLine={false} tickLine={false} unit={unit}/>
      <Tooltip labelFormatter={(value) => prettyDate(String(value), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} formatter={(value) => [value == null ? 'No measurement' : `${Number(value).toFixed(1)} ${unit}`, 'Weight']} contentStyle={{ background: '#19191b', border: '1px solid #303034', borderRadius: 12, color: '#f5f5f7', fontSize: 12, padding: '10px 12px' }}/>
      <ReferenceLine y={0} stroke="transparent"/>
      <Line type="monotone" dataKey="value" name="Weight" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--accent)', stroke: '#000000', strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={!reduceMotion} animationDuration={380} animationEasing="ease-out"/>
    </LineChart>
  </ResponsiveContainer>;
}

export function ScoreHistoryChart({ scores, periodLabel = 'Week of' }: { scores: { period: string; score: number | null }[]; periodLabel?: 'Week of' | 'Month of' }) {
  const reduceMotion = useReducedMotion();
  return <ResponsiveContainer width="100%" height={190}>
    <LineChart data={scores} margin={{ top: 8, right: 8, left: -14, bottom: 2 }}>
      <CartesianGrid stroke="#ffffff0b" vertical={false}/>
      <XAxis dataKey="period" tickFormatter={shortDate} minTickGap={30} tick={{ fill: '#929297', fontSize: 11 }} axisLine={false} tickLine={false}/>
      <YAxis domain={[0,100]} tick={{ fill: '#929297', fontSize: 11 }} axisLine={false} tickLine={false} unit="%"/>
      <Tooltip labelFormatter={(value) => `${periodLabel} ${prettyDate(String(value), { month: 'short', day: periodLabel === 'Month of' ? undefined : 'numeric', year: 'numeric' })}`} formatter={(value) => [value == null ? 'Insufficient data' : `${value}%`, 'Score']} contentStyle={{ background: '#19191b', border: '1px solid #303034', borderRadius: 12, color: '#f5f5f7', fontSize: 12, padding: '10px 12px' }}/>
      <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--accent)' }} connectNulls={false} isAnimationActive={!reduceMotion} animationDuration={380} animationEasing="ease-out"/>
    </LineChart>
  </ResponsiveContainer>;
}

export type RhythmMetric = 'focusMinutes' | 'screenTimeMinutes' | 'readingMinutes' | 'communicationMinutes' | 'technicalLearningMinutes' | 'problemSolvingMinutes' | 'sleepHours' | 'energy';
export function RhythmChart({ data, metric }: { data: Array<{ date: string } & Record<RhythmMetric, number | null>>; metric: RhythmMetric }) {
  const hours = metric === 'sleepHours';
  const energy = metric === 'energy';
  const reduceMotion = useReducedMotion();
  return <ResponsiveContainer width="100%" height={210}>
    <LineChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 2 }}>
      <CartesianGrid stroke="#ffffff0b" vertical={false}/>
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28} tick={{ fill: '#929297', fontSize: 11 }} axisLine={false} tickLine={false}/>
      <YAxis width={38} tick={{ fill: '#929297', fontSize: 11 }} axisLine={false} tickLine={false} unit={hours ? 'h' : energy ? '/5' : 'm'}/>
      <Tooltip labelFormatter={(value) => prettyDate(String(value), { weekday: 'short', month: 'short', day: 'numeric' })} formatter={(value) => [value == null ? 'Not logged' : `${value}${hours ? ' h' : energy ? ' / 5' : ' min'}`, hours ? 'Sleep' : energy ? 'Energy' : 'Time']} contentStyle={{ background: '#19191b', border: '1px solid #303034', borderRadius: 12, color: '#f5f5f7', fontSize: 12, padding: '10px 12px' }}/>
      <Line type="monotone" dataKey={metric} name="Time" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 2.5, fill: 'var(--accent)', stroke: '#000000', strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={!reduceMotion} animationDuration={380} animationEasing="ease-out"/>
    </LineChart>
  </ResponsiveContainer>;
}
