import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { addFoodEntries, db, removeFoodEntry, removeMealEntries, updateDayRecord } from '../src/lib/db';
import { nutritionTotals } from '../src/lib/nutrition';
import { isValidDayChange } from '../src/lib/day-inputs';
import type { FoodEntry } from '../src/lib/types';

const breakfast: FoodEntry = { id: 'breakfast', name: 'Oats', meal: 'breakfast', calories: 300, protein: 12, carbs: 40, fat: 8 };
const lunch: FoodEntry = { id: 'lunch', name: 'Rice and lentils', meal: 'lunch', calories: 450, protein: 18, carbs: 70, fat: 10 };

test('manual daily nutrition remains after adding and removing food entries', async () => {
  const date = '2026-11-01';
  await updateDayRecord(date, { calories: 900, protein: 40 });
  await addFoodEntries(date, [breakfast], 'breakfast');
  let day = (await db.days.get(date))!;
  assert.equal(day.calories, 1200);
  assert.equal(day.protein, 52);
  assert.deepEqual(nutritionTotals(day), { calories: 1200, protein: 52, carbs: 40, fat: 8 });
  await removeFoodEntry(date, breakfast.id);
  day = (await db.days.get(date))!;
  assert.equal(day.calories, 900);
  assert.equal(day.protein, 40);
  assert.equal(day.carbs, undefined);
  assert.equal(day.fat, undefined);
  assert.equal(day.states.breakfast, 'unrecorded');
});

test('legacy aggregate values preserve only the nutrition beyond logged food', async () => {
  const date = '2026-11-02';
  await db.days.put({ date, foodEntries: [breakfast], calories: 1100, protein: 42, carbs: 40, fat: 8, states: { breakfast: 'done' }, updatedAt: 1 });
  await addFoodEntries(date, [lunch], 'lunch');
  let day = (await db.days.get(date))!;
  assert.equal(day.calories, 1550);
  assert.deepEqual(day.nutritionBase, { calories: 800, protein: 30 });
  await removeMealEntries(date, 'breakfast');
  await removeMealEntries(date, 'lunch');
  day = (await db.days.get(date))!;
  assert.equal(day.calories, 800);
  assert.equal(day.protein, 30);
  assert.equal(day.carbs, undefined);
});

test('concurrent additions and removals preserve independent meal entries and tracker states', async () => {
  const date = '2026-11-03';
  await Promise.all([addFoodEntries(date, [breakfast], 'breakfast'), addFoodEntries(date, [lunch], 'lunch'), updateDayRecord(date, { states: { reading: 'done' } })]);
  let day = (await db.days.get(date))!;
  assert.equal(day.foodEntries?.length, 2);
  assert.equal(day.calories, 750);
  assert.equal(day.states.reading, 'done');
  const extra: FoodEntry = { id: 'extra', name: 'Yogurt', meal: 'extra', calories: 100, protein: 8 };
  await Promise.all([removeFoodEntry(date, breakfast.id), addFoodEntries(date, [extra])]);
  day = (await db.days.get(date))!;
  assert.deepEqual(day.foodEntries?.map((entry) => entry.id).sort(), ['extra', 'lunch']);
  assert.equal(day.calories, 550);
  assert.equal(day.states.lunch, 'done');
  assert.equal(day.states.breakfast, 'unrecorded');
  assert.equal(day.states.reading, 'done');
  await addFoodEntries(date, [extra]);
  assert.equal((await db.days.get(date))?.foodEntries?.length, 2);
});

test('invalid food payloads and oversized aggregate totals fail before storing changes', async () => {
  assert.equal(isValidDayChange({ foodEntries: [{ ...breakfast, id: null as unknown as string }] }), false);
  assert.equal(isValidDayChange({ nutritionBase: { calories: 20001 } }), false);
  const date = '2026-11-04';
  await updateDayRecord(date, { calories: 19900 });
  await assert.rejects(addFoodEntries(date, [breakfast]), /daily nutrition limits/);
  const day = (await db.days.get(date))!;
  assert.equal(day.calories, 19900);
  assert.equal(day.foodEntries, undefined);
});
