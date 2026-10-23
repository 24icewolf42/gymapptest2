// Built-in exercise list for the plan editor. Works offline.

export const CATEGORIES = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', triceps: 'Triceps', biceps: 'Biceps',
  forearms: 'Forearms', quads: 'Quads', hamstrings: 'Hamstrings', calves: 'Calves', abs: 'Abs',
  lowerback: 'Lower back', hips: 'Hips & glutes', conditioning: 'Conditioning', other: 'Other',
};

export function categoryLabel(cat) {
  return CATEGORIES[cat] || (cat ? String(cat) : 'Other');
}

const LIST = [
  ['Barbell Back Squat', 'quads'], ['Front Squat', 'quads'], ['Goblet Squat', 'quads'], ['Bulgarian Split Squat', 'quads'],
  ['Walking Lunge', 'quads'], ['Reverse Lunge', 'quads'], ['Leg Press', 'quads'], ['Hack Squat', 'quads'],
  ['Leg Extension', 'quads'], ['Step-up', 'quads'], ['Sissy Squat', 'quads'],
  ['Romanian Deadlift', 'hamstrings'], ['Conventional Deadlift', 'back'], ['Sumo Deadlift', 'hamstrings'],
  ['Hip Thrust', 'hips'], ['Glute Bridge', 'hips'], ['Leg Curl', 'hamstrings'], ['Seated Leg Curl', 'hamstrings'],
  ['Good Morning', 'hamstrings'], ['Back Extension', 'lowerback'], ['Standing Calf Raise', 'calves'], ['Seated Calf Raise', 'calves'],
  ['Barbell Bench Press', 'chest'], ['Incline Barbell Press', 'chest'], ['Incline Dumbbell Press', 'chest'],
  ['Smith Machine Incline Bench Press', 'chest'], ['Dumbbell Floor Press', 'chest'], ['Push-up', 'chest'], ['Cable Fly', 'chest'],
  ['Pec Deck', 'chest'], ['Chest Press Machine', 'chest'], ['Dips', 'chest'],
  ['Overhead Press', 'shoulders'], ['Shoulder Press Machine', 'shoulders'], ['Dumbbell Lateral Raise', 'shoulders'],
  ['Cable Lateral Raise', 'shoulders'], ['Single-Arm Cable Lateral Raises', 'shoulders', true], ['Face Pull', 'shoulders'],
  ['Rear Delt Fly', 'shoulders'], ['Reverse Chest Fly Machine', 'shoulders'], ['Arnold Press', 'shoulders'], ['Upright Row', 'shoulders'],
  ['Pull-up', 'back'], ['Assisted Pull-Ups', 'back'], ['Chin-up', 'back'], ['Lat Pulldown', 'back'], ['Close-grip Lat Pulldown', 'back'],
  ['Barbell Row', 'back'], ['One-arm Dumbbell Row', 'back', true], ['Seated Cable Row', 'back'], ['Chest-supported Row', 'back'],
  ['T-Bar Row', 'back'], ['Straight-arm Pulldown', 'back'], ['Shrug', 'back'],
  ['Dumbbell Curl', 'biceps'], ['Hammer Curl', 'biceps'], ['Preacher Curl', 'biceps'], ['Cable Curl', 'biceps'],
  ['Concentration Curl', 'biceps', true], ['Reverse Cable Bicep Curls', 'forearms'],
  ['Triceps Pushdown', 'triceps'], ['Single-Arm Tricep Pushdowns', 'triceps', true], ['Overhead Triceps Extension', 'triceps'],
  ['Skull Crusher', 'triceps'], ['Close-grip Bench Press', 'triceps'],
  ['Plank', 'abs'], ['Side Plank', 'abs'], ['Hanging Leg Raise', 'abs'], ['Cable Crunch', 'abs'], ['Abdominal Crunch Machine', 'abs'],
  ['Ab Wheel Rollout', 'abs'], ['Pallof Press', 'abs'], ['Russian Twist', 'abs'], ['Farmer Carry', 'forearms'],
  ['Hip Abduction Machine', 'hips'], ['Hip Adduction Machine', 'hips'],
  ['Jump Rope', 'conditioning'], ['Burpee', 'conditioning'], ['Mountain Climber', 'conditioning'], ['Treadmill Run', 'conditioning'], ['Cycling', 'conditioning'],
];

export const CATALOG = LIST.map(([name, cat, unilateral]) => ({ name, cat, unilateral: !!unilateral }));

export function searchCatalog(query, extra = []) {
  const q = String(query || '').trim().toLowerCase();
  const seen = new Set();
  return [...CATALOG, ...extra].filter((x) => {
    const key = x.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return !q || key.includes(q) || x.cat.includes(q) || categoryLabel(x.cat).toLowerCase().includes(q);
  });
}
