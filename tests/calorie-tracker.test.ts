import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { db, updateDayRecord } from '../src/lib/db';
import { isValidDayChange } from '../src/lib/day-inputs';
import type { FoodEntry, DayRecord } from '../src/lib/types';

test('calorie tracker: auto-checks breakfast, lunch, snacks, and dinner habits when logged', async () => {
  const date = '2026-10-18';
  await db.days.delete(date);

  // 1. Log Breakfast
  const breakfastItem: FoodEntry = {
    id: 'f-1',
    name: 'Oatmeal with berries',
    meal: 'breakfast',
    calories: 320,
    protein: 11,
    carbs: 58,
    fat: 5,
  };
  await updateDayRecord(date, {
    foodEntries: [breakfastItem],
    calories: 320,
    protein: 11,
    carbs: 58,
    fat: 5,
    states: { breakfast: 'done' },
  });

  let record = await db.days.get(date);
  assert.equal(record?.calories, 320);
  assert.equal(record?.protein, 11);
  assert.equal(record?.carbs, 58);
  assert.equal(record?.fat, 5);
  assert.equal(record?.states.breakfast, 'done');
  assert.equal(record?.states.lunch, undefined);
  assert.equal(record?.states.snacks, undefined);
  assert.equal(record?.states.dinner, undefined);

  // 2. Log Lunch
  const lunchItem: FoodEntry = {
    id: 'f-2',
    name: 'Grilled chicken salad',
    meal: 'lunch',
    calories: 450,
    protein: 42,
    carbs: 18,
    fat: 14,
  };
  await updateDayRecord(date, {
    foodEntries: [breakfastItem, lunchItem],
    calories: 320 + 450,
    protein: 11 + 42,
    carbs: 58 + 18,
    fat: 5 + 14,
    states: { lunch: 'done' },
  });

  record = await db.days.get(date);
  assert.equal(record?.calories, 770);
  assert.equal(record?.protein, 53);
  assert.equal(record?.states.breakfast, 'done');
  assert.equal(record?.states.lunch, 'done');
  assert.equal(record?.states.snacks, undefined);

  // 3. Log Snack
  const snackItem: FoodEntry = {
    id: 'f-3',
    name: 'Mixed nuts',
    meal: 'snacks',
    calories: 180,
    protein: 5,
    carbs: 6,
    fat: 16,
  };
  await updateDayRecord(date, {
    foodEntries: [breakfastItem, lunchItem, snackItem],
    calories: 770 + 180,
    protein: 53 + 5,
    carbs: 76 + 6,
    fat: 19 + 16,
    states: { snacks: 'done' },
  });

  record = await db.days.get(date);
  assert.equal(record?.calories, 950);
  assert.equal(record?.states.breakfast, 'done');
  assert.equal(record?.states.lunch, 'done');
  assert.equal(record?.states.snacks, 'done');
  assert.equal(record?.states.dinner, undefined);

  // 4. Log Dinner
  const dinnerItem: FoodEntry = {
    id: 'f-4',
    name: 'Salmon with sweet potato',
    meal: 'dinner',
    calories: 620,
    protein: 46,
    carbs: 45,
    fat: 22,
  };
  await updateDayRecord(date, {
    foodEntries: [breakfastItem, lunchItem, snackItem, dinnerItem],
    calories: 950 + 620,
    protein: 58 + 46,
    carbs: 82 + 45,
    fat: 35 + 22,
    states: { dinner: 'done' },
  });

  record = await db.days.get(date);
  assert.equal(record?.calories, 1570);
  assert.equal(record?.protein, 104);
  assert.equal(record?.states.breakfast, 'done');
  assert.equal(record?.states.lunch, 'done');
  assert.equal(record?.states.snacks, 'done');
  assert.equal(record?.states.dinner, 'done');

  // 5. Log Extra: should add calories but NOT mark any meal tracker
  const extraItem: FoodEntry = {
    id: 'f-5',
    name: 'Dark chocolate',
    meal: 'extra',
    calories: 120,
    protein: 2,
    carbs: 13,
    fat: 8,
  };
  await updateDayRecord(date, {
    foodEntries: [breakfastItem, lunchItem, snackItem, dinnerItem, extraItem],
    calories: 1570 + 120,
    protein: 104 + 2,
    carbs: 127 + 13,
    fat: 57 + 8,
    // NO states provided for extra
  });

  record = await db.days.get(date);
  assert.equal(record?.calories, 1690);
  assert.equal(record?.protein, 106);
  assert.equal(record?.foodEntries?.length, 5);
  // Ensure the meal states remain intact and no 'extra' state exists
  assert.equal(record?.states.breakfast, 'done');
  assert.equal(record?.states.lunch, 'done');
  assert.equal(record?.states.snacks, 'done');
  assert.equal(record?.states.dinner, 'done');
  assert.equal((record?.states as any).extra, undefined);
});

test('calorie tracker: removing a food entry updates totals without corrupting other meals', async () => {
  const date = '2026-10-19';
  await db.days.delete(date);

  const entry1: FoodEntry = { id: '1', name: 'Egg', meal: 'breakfast', calories: 80, protein: 6, carbs: 0, fat: 5 };
  const entry2: FoodEntry = { id: '2', name: 'Toast', meal: 'breakfast', calories: 90, protein: 3, carbs: 15, fat: 1 };
  const entry3: FoodEntry = { id: '3', name: 'Coffee', meal: 'extra', calories: 50, protein: 1, carbs: 5, fat: 2 };

  await updateDayRecord(date, {
    foodEntries: [entry1, entry2, entry3],
    calories: 220,
    protein: 10,
    carbs: 20,
    fat: 8,
    states: { breakfast: 'done' },
  });

  // Remove toast
  const remaining = [entry1, entry3];
  await updateDayRecord(date, {
    foodEntries: remaining,
    calories: 130,
    protein: 7,
    carbs: 5,
    fat: 7,
  });

  const record = await db.days.get(date);
  assert.equal(record?.foodEntries?.length, 2);
  assert.equal(record?.calories, 130);
  assert.equal(record?.protein, 7);
  assert.equal(record?.carbs, 5);
  assert.equal(record?.fat, 7);
  assert.equal(record?.states.breakfast, 'done');
});

test('calorie tracker: input validation rejects invalid food entries and values', () => {
  // Valid entry
  assert.equal(isValidDayChange({
    calories: 1800,
    protein: 120,
    carbs: 200,
    fat: 60,
    foodEntries: [{ id: 'valid-1', name: 'Apple', meal: 'snacks', calories: 95 }],
  }), true);

  // Accepts 'extra' meal
  assert.equal(isValidDayChange({
    foodEntries: [{ id: 'valid-2', name: 'Latte', meal: 'extra', calories: 150 }],
  }), true);

  // Rejects invalid meal type
  assert.equal(isValidDayChange({
    foodEntries: [{ id: 'invalid-meal', name: 'Food', meal: 'midnight_snack' as any, calories: 100 }],
  }), false);

  // Rejects empty food name or ID
  assert.equal(isValidDayChange({
    foodEntries: [{ id: '', name: 'Food', meal: 'lunch', calories: 100 }],
  }), false);
  assert.equal(isValidDayChange({
    foodEntries: [{ id: '1', name: '   ', meal: 'lunch', calories: 100 }],
  }), false);

  // Rejects negative or excessive calories
  assert.equal(isValidDayChange({
    foodEntries: [{ id: '1', name: 'Food', meal: 'lunch', calories: -10 }],
  }), false);
  assert.equal(isValidDayChange({
    foodEntries: [{ id: '1', name: 'Food', meal: 'lunch', calories: 25000 }],
  }), false);

  // Rejects invalid day calories
  assert.equal(isValidDayChange({ calories: -1 }), false);
  assert.equal(isValidDayChange({ calories: 25000 }), false);
  assert.equal(isValidDayChange({ protein: -5 }), false);
});

test('calorie tracker: rapid concurrent writes preserve all changes', async () => {
  const date = '2026-10-20';
  await db.days.delete(date);

  // Fire 5 writes concurrently
  await Promise.all([
    updateDayRecord(date, { states: { breakfast: 'done' } }),
    updateDayRecord(date, { intention: 'Drink 2L water' }),
    updateDayRecord(date, { states: { workout: 'done' } }),
    updateDayRecord(date, {
      foodEntries: [{ id: 'c-1', name: 'Protein shake', meal: 'snacks', calories: 200, protein: 25 }],
      calories: 200,
      protein: 25,
    }),
    updateDayRecord(date, { states: { reading: 'done' } }),
  ]);

  const record = await db.days.get(date);
  assert.equal(record?.states.breakfast, 'done');
  assert.equal(record?.states.workout, 'done');
  assert.equal(record?.states.reading, 'done');
  assert.equal(record?.intention, 'Drink 2L water');
  assert.equal(record?.calories, 200);
  assert.equal(record?.protein, 25);
  assert.equal(record?.foodEntries?.length, 1);
  assert.equal(record?.foodEntries?.[0].name, 'Protein shake');
});

test('calorie tracker: macro totals are preserved when foods have 0 or partial values', async () => {
  const date = '2026-10-21';
  await db.days.delete(date);

  // Steak has 0 carbs, Sugar has 0 protein and 0 fat
  const steak: FoodEntry = { id: 's-1', name: 'Steak', meal: 'dinner', calories: 400, protein: 48, carbs: 0, fat: 22 };
  const sugar: FoodEntry = { id: 's-2', name: 'Honey in tea', meal: 'extra', calories: 64, protein: 0, carbs: 17, fat: 0 };

  const entries = [steak, sugar];
  const calTotal = entries.reduce((s, e) => s + e.calories, 0);
  const protTotal = Number(entries.reduce((s, e) => s + (e.protein ?? 0), 0).toFixed(1));
  const carbTotal = Number(entries.reduce((s, e) => s + (e.carbs ?? 0), 0).toFixed(1));
  const fatTotal = Number(entries.reduce((s, e) => s + (e.fat ?? 0), 0).toFixed(1));

  await updateDayRecord(date, {
    foodEntries: entries,
    calories: calTotal,
    protein: protTotal,
    carbs: carbTotal,
    fat: fatTotal,
    states: { dinner: 'done' },
  });

  const record = await db.days.get(date);
  assert.equal(record?.calories, 464);
  assert.equal(record?.protein, 48);
  assert.equal(record?.carbs, 17);
  assert.equal(record?.fat, 22);
  assert.equal(record?.states.dinner, 'done');
});

test('calorie tracker: deleting an entire meal pack updates nutrition totals and resets habit to unrecorded', async () => {
  const date = '2026-10-22';
  await db.days.delete(date);

  const b1: FoodEntry = { id: 'b-1', name: 'Eggs', meal: 'breakfast', calories: 150, protein: 12, carbs: 1, fat: 10 };
  const b2: FoodEntry = { id: 'b-2', name: 'Toast', meal: 'breakfast', calories: 120, protein: 4, carbs: 22, fat: 2 };
  const l1: FoodEntry = { id: 'l-1', name: 'Salad bowl', meal: 'lunch', calories: 400, protein: 30, carbs: 20, fat: 15 };
  const d1: FoodEntry = { id: 'd-1', name: 'Fish & rice', meal: 'dinner', calories: 550, protein: 40, carbs: 60, fat: 12 };

  const allEntries = [b1, b2, l1, d1];
  await updateDayRecord(date, {
    foodEntries: allEntries,
    calories: 150 + 120 + 400 + 550, // 1220
    protein: 12 + 4 + 30 + 40,       // 86
    carbs: 1 + 22 + 20 + 60,         // 103
    fat: 10 + 2 + 15 + 12,           // 39
    states: { breakfast: 'done', lunch: 'done', dinner: 'done' },
  });

  let record = await db.days.get(date);
  assert.equal(record?.calories, 1220);
  assert.equal(record?.states.breakfast, 'done');
  assert.equal(record?.states.lunch, 'done');
  assert.equal(record?.states.dinner, 'done');

  // Simulate deleting the 'breakfast' meal pack
  const remainingAfterBreakfast = allEntries.filter((e) => e.meal !== 'breakfast');
  const calAfter = remainingAfterBreakfast.reduce((s, e) => s + e.calories, 0);
  const protAfter = Number(remainingAfterBreakfast.reduce((s, e) => s + (e.protein ?? 0), 0).toFixed(1));
  const carbAfter = Number(remainingAfterBreakfast.reduce((s, e) => s + (e.carbs ?? 0), 0).toFixed(1));
  const fatAfter = Number(remainingAfterBreakfast.reduce((s, e) => s + (e.fat ?? 0), 0).toFixed(1));

  await updateDayRecord(date, {
    foodEntries: remainingAfterBreakfast,
    calories: calAfter,
    protein: protAfter,
    carbs: carbAfter,
    fat: fatAfter,
    states: { breakfast: 'unrecorded' },
  });

  record = await db.days.get(date);
  assert.equal(record?.foodEntries?.length, 2);
  assert.equal(record?.calories, 950);
  assert.equal(record?.protein, 70);
  assert.equal(record?.carbs, 80);
  assert.equal(record?.fat, 27);
  // Breakfast is reset to unrecorded while lunch & dinner stay done
  assert.equal(record?.states.breakfast, 'unrecorded');
  assert.equal(record?.states.lunch, 'done');
  assert.equal(record?.states.dinner, 'done');

  // Now delete all remaining meals (lunch and dinner)
  await updateDayRecord(date, {
    foodEntries: [],
    calories: undefined,
    protein: undefined,
    carbs: undefined,
    fat: undefined,
    states: { lunch: 'unrecorded', dinner: 'unrecorded' },
  });

  record = await db.days.get(date);
  assert.equal(record?.foodEntries?.length, 0);
  assert.equal(record?.calories, undefined);
  assert.equal(record?.protein, undefined);
  assert.equal(record?.carbs, undefined);
  assert.equal(record?.fat, undefined);
  assert.equal(record?.states.breakfast, 'unrecorded');
  assert.equal(record?.states.lunch, 'unrecorded');
  assert.equal(record?.states.dinner, 'unrecorded');
});

test('calorie tracker: removing last food entry of a meal resets habit to unrecorded', async () => {
  const date = '2026-10-23';
  await db.days.delete(date);

  const snack: FoodEntry = { id: 's-1', name: 'Apple', meal: 'snacks', calories: 95, protein: 0.5, carbs: 25, fat: 0.3 };
  await updateDayRecord(date, {
    foodEntries: [snack],
    calories: 95,
    protein: 0.5,
    carbs: 25,
    fat: 0.3,
    states: { snacks: 'done' },
  });

  let record = await db.days.get(date);
  assert.equal(record?.states.snacks, 'done');
  assert.equal(record?.calories, 95);

  // Removing the only snack item
  await updateDayRecord(date, {
    foodEntries: [],
    calories: undefined,
    protein: undefined,
    carbs: undefined,
    fat: undefined,
    states: { snacks: 'unrecorded' },
  });

  record = await db.days.get(date);
  assert.equal(record?.foodEntries?.length, 0);
  assert.equal(record?.calories, undefined);
  assert.equal(record?.states.snacks, 'unrecorded');
});

