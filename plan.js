/* Weekly plan editor, workout navigation, and rest-day image settings. */
(function () {
  'use strict';

  var root = document.getElementById('planRoot');
  var days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var selectedDay = null;
  var selectedWorkout = null;
  var selectedMuscle = 'All';
  var muscleGroups = { chest: 'Chest', back: 'Back', shoulders: 'Shoulders', triceps: 'Arms', biceps: 'Arms', forearms: 'Arms', quads: 'Legs', hamstrings: 'Legs', calves: 'Legs', hips: 'Legs', abs: 'Core', lowerback: 'Core', conditioning: 'Conditioning' };
  var unilateral = /single[- ]arm|one[- ]arm|single[- ]leg|one[- ]leg|unilateral/i;
  var moves = [
    ['Barbell Back Squat','quads'],['Front Squat','quads'],['Goblet Squat','quads'],['Bulgarian Split Squat','quads'],['Walking Lunge','quads'],['Reverse Lunge','quads'],['Leg Press','quads'],['Hack Squat','quads'],['Leg Extension','quads'],['Step-up','quads'],['Sissy Squat','quads'],
    ['Romanian Deadlift','hamstrings'],['Conventional Deadlift','back'],['Sumo Deadlift','hamstrings'],['Hip Thrust','hips'],['Glute Bridge','hips'],['Leg Curl','hamstrings'],['Seated Leg Curl','hamstrings'],['Good Morning','hamstrings'],['Back Extension','back'],['Standing Calf Raise','calves'],['Seated Calf Raise','calves'],
    ['Barbell Bench Press','chest'],['Incline Barbell Press','chest'],['Incline Dumbbell Press','chest'],['Dumbbell Floor Press','chest'],['Push-up','chest'],['Cable Fly','chest'],['Pec Deck','chest'],['Chest Press Machine','chest'],['Dips','chest'],
    ['Overhead Press','shoulders'],['Dumbbell Lateral Raise','shoulders'],['Cable Lateral Raise','shoulders'],['Face Pull','shoulders'],['Rear Delt Fly','shoulders'],['Arnold Press','shoulders'],['Upright Row','shoulders'],
    ['Pull-up','back'],['Chin-up','back'],['Lat Pulldown','back'],['Close-grip Lat Pulldown','back'],['Barbell Row','back'],['One-arm Dumbbell Row','back'],['Seated Cable Row','back'],['Chest-supported Row','back'],['T-Bar Row','back'],['Straight-arm Pulldown','back'],['Shrug','back'],
    ['Dumbbell Curl','biceps'],['Hammer Curl','biceps'],['Preacher Curl','biceps'],['Cable Curl','biceps'],['Concentration Curl','biceps'],['Triceps Pushdown','triceps'],['Overhead Triceps Extension','triceps'],['Skull Crusher','triceps'],['Close-grip Bench Press','triceps'],
    ['Plank','abs'],['Side Plank','abs'],['Hanging Leg Raise','abs'],['Cable Crunch','abs'],['Ab Wheel Rollout','abs'],['Pallof Press','abs'],['Russian Twist','abs'],['Farmer Carry','forearms'],['Hip Abduction','hips'],['Hip Adduction','hips'],['Jump Rope','conditioning'],['Burpee','conditioning'],['Mountain Climber','conditioning'],['Treadmill Run','conditioning'],['Cycling','conditioning'],
    ['Meow Curls','biceps'],['Spider Curl','biceps'],['Bayesian Cable Curl','biceps'],['Incline Dumbbell Curl','biceps'],['EZ-Bar Curl','biceps'],['Drag Curl','biceps'],['Zottman Curl','biceps'],['Reverse Curl','forearms'],['Wrist Curl','forearms'],['Reverse Wrist Curl','forearms'],['Wrist Roller','forearms'],['Plate Pinch','forearms'],['Dead Hang','forearms'],['Rope Hammer Curl','biceps'],['Machine Biceps Curl','biceps'],['Single-Arm Cable Curl','biceps'],['Single-Arm Preacher Curl','biceps'],['Single-Arm Concentration Curl','biceps'],
    ['Flat Dumbbell Bench Press','chest'],['Decline Barbell Bench Press','chest'],['Decline Dumbbell Press','chest'],['Smith Machine Bench Press','chest'],['Smith Machine Incline Bench Press','chest'],['Smith Machine Decline Press','chest'],['Machine Incline Chest Press','chest'],['Machine Decline Chest Press','chest'],['Single-Arm Chest Press Machine','chest'],['Single-Arm Cable Fly','chest'],['Low-to-High Cable Fly','chest'],['High-to-Low Cable Fly','chest'],['Cable Crossover','chest'],['Dumbbell Fly','chest'],['Incline Dumbbell Fly','chest'],['Decline Dumbbell Fly','chest'],['Svend Press','chest'],['Landmine Press','chest'],['Deficit Push-up','chest'],['Incline Push-up','chest'],['Decline Push-up','chest'],['Diamond Push-up','chest'],['Wide Push-up','chest'],['Weighted Push-up','chest'],['Assisted Dip','chest'],['Ring Dip','chest'],['Single-Arm Machine Chest Press','chest'],
    ['Pendlay Row','back'],['Seal Row','back'],['Meadows Row','back'],['Single-Arm Cable Row','back'],['Single-Arm Machine Row','back'],['Single-Arm Lat Pulldown','back'],['Single-Arm Straight-Arm Pulldown','back'],['Wide-Grip Lat Pulldown','back'],['Neutral-Grip Lat Pulldown','back'],['Underhand Lat Pulldown','back'],['Assisted Pull-Up','back'],['Weighted Pull-Up','back'],['Wide-Grip Pull-Up','back'],['Neutral-Grip Pull-Up','back'],['Inverted Row','back'],['TRX Row','back'],['Machine High Row','back'],['Plate-Loaded Row','back'],['Iso-Lateral Row Machine','back'],['Cable Face Pull','back'],['Dumbbell Pullover','back'],['Cable Pullover','back'],['Rack Pull','back'],['Snatch-Grip Deadlift','back'],['Deficit Deadlift','back'],['Trap-Bar Deadlift','back'],['Single-Arm Dumbbell Row','back'],['Single-Arm Landmine Row','back'],['Single-Arm Chest-Supported Row','back'],['Single-Arm Kneeling Lat Pulldown','back'],['Single-Arm Reverse Fly','back'],['Single-Arm Face Pull','back'],['Single-Arm Shrug','back'],
    ['Dumbbell Shoulder Press','shoulders'],['Seated Dumbbell Shoulder Press','shoulders'],['Machine Shoulder Press','shoulders'],['Shoulder Press Machine','shoulders'],['Push Press','shoulders'],['Z Press','shoulders'],['Seated Barbell Press','shoulders'],['Smith Machine Shoulder Press','shoulders'],['Cable Front Raise','shoulders'],['Dumbbell Front Raise','shoulders'],['Plate Front Raise','shoulders'],['Lean-Away Lateral Raise','shoulders'],['Machine Lateral Raise','shoulders'],['Single-Arm Cable Lateral Raises','shoulders'],['Single-Arm Dumbbell Lateral Raise','shoulders'],['Single-Arm Machine Lateral Raise','shoulders'],['Bent-Over Rear Delt Raise','shoulders'],['Reverse Pec Deck','shoulders'],['Cable Rear Delt Fly','shoulders'],['Single-Arm Cable Rear Delt Fly','shoulders'],['Y Raise','shoulders'],['Lu Raise','shoulders'],['Upright Cable Row','shoulders'],['Cable External Rotation','shoulders'],['Dumbbell External Rotation','shoulders'],
    ['Rope Triceps Pushdown','triceps'],['Straight-Bar Triceps Pushdown','triceps'],['V-Bar Triceps Pushdown','triceps'],['Single-Arm Tricep Pushdowns','triceps'],['Single-Arm Reverse-Grip Pushdown','triceps'],['Single-Arm Overhead Cable Extension','triceps'],['Cable Overhead Triceps Extension','triceps'],['Dumbbell Overhead Triceps Extension','triceps'],['Single-Arm Dumbbell Triceps Extension','triceps'],['EZ-Bar Skull Crusher','triceps'],['Dumbbell Skull Crusher','triceps'],['JM Press','triceps'],['Triceps Kickback','triceps'],['Single-Arm Cable Kickback','triceps'],['Bench Dip','triceps'],['Close-Grip Push-up','triceps'],['Assisted Triceps Dip','triceps'],['Machine Triceps Extension','triceps'],
    ['Back Squat','quads'],['High-Bar Back Squat','quads'],['Low-Bar Back Squat','quads'],['Pause Squat','quads'],['Box Squat','quads'],['Safety Bar Squat','quads'],['Zercher Squat','quads'],['Landmine Squat','quads'],['Belt Squat','quads'],['Smith Machine Squat','quads'],['Smith Machine Hack Squat','quads'],['Pendulum Squat','quads'],['V-Squat Machine','quads'],['Single-Leg Press','quads'],['Narrow-Stance Leg Press','quads'],['Wide-Stance Leg Press','quads'],['Single-Leg Extension','quads'],['Spanish Squat','quads'],['Cyclist Squat','quads'],['Heels-Elevated Goblet Squat','quads'],['Front-Foot Elevated Split Squat','quads'],['Rear-Foot Elevated Split Squat','quads'],['Single-Leg Box Step-Up','quads'],['Lateral Lunge','quads'],['Curtsy Lunge','quads'],['Cossack Squat','quads'],['Reverse Nordic Curl','quads'],['Sled Push','quads'],['Sled Drag','quads'],
    ['Stiff-Leg Deadlift','hamstrings'],['Dumbbell Romanian Deadlift','hamstrings'],['Single-Leg Romanian Deadlift','hamstrings'],['Single-Leg Dumbbell RDL','hamstrings'],['Single-Leg Cable RDL','hamstrings'],['Barbell Good Morning','hamstrings'],['Seated Good Morning','hamstrings'],['Nordic Hamstring Curl','hamstrings'],['Glute-Ham Raise','hamstrings'],['Lying Leg Curl','hamstrings'],['Standing Leg Curl','hamstrings'],['Single-Leg Seated Leg Curl','hamstrings'],['Single-Leg Lying Leg Curl','hamstrings'],['Cable Pull-Through','hamstrings'],['Kettlebell Swing','hamstrings'],['Reverse Hyperextension','hamstrings'],['45-Degree Back Extension','lowerback'],['Single-Leg Hip Thrust','hips'],['Barbell Glute Bridge','hips'],['Cable Glute Kickback','hips'],['Single-Leg Cable Kickback','hips'],['Hip Thrust Machine','hips'],['Frog Pump','hips'],['Clamshell','hips'],['Banded Lateral Walk','hips'],['Cable Hip Abduction','hips'],['Cable Hip Adduction','hips'],['Single-Leg Calf Raise','calves'],['Leg Press Calf Raise','calves'],['Donkey Calf Raise','calves'],['Tibialis Raise','calves'],['Seated Tibialis Raise','calves'],
    ['Decline Sit-Up','abs'],['Weighted Crunch','abs'],['Machine Crunch','abs'],['Abdominal Crunch Machine','abs'],['Reverse Crunch','abs'],['V-Up','abs'],['L-Sit','abs'],['Hollow Body Hold','abs'],['Dead Bug','abs'],['Bird Dog','abs'],['Bicycle Crunch','abs'],['Wood Chop','abs'],['Cable Wood Chop','abs'],['Single-Arm Cable Wood Chop','abs'],['Landmine Rotation','abs'],['Hanging Knee Raise','abs'],['Captain’s Chair Knee Raise','abs'],['Dragon Flag','abs'],['Stability Ball Rollout','abs'],['Suitcase Carry','forearms'],['Single-Arm Farmer Carry','forearms'],['Barbell Rollout','abs'],
    ['Elliptical','conditioning'],['Rowing Machine','conditioning'],['Stair Climber','conditioning'],['Ski Erg','conditioning'],['Air Bike','conditioning'],['Assault Bike','conditioning'],['Incline Treadmill Walk','conditioning'],['Outdoor Run','conditioning'],['Sled Sprint','conditioning'],['Battle Ropes','conditioning'],['Box Jump','conditioning'],['Jumping Jack','conditioning'],['High Knees','conditioning'],['Burpee Broad Jump','conditioning'],['Bear Crawl','conditioning'],['Kettlebell Clean and Press','conditioning'],['Turkish Get-Up','conditioning'],['Single-Arm Kettlebell Swing','conditioning']
  ].map(function (x) { return { name: x[0], cat: x[1] }; });
  moves = moves.filter(function (move, index, all) { return all.findIndex(function (other) { return other.name.toLowerCase() === move.name.toLowerCase(); }) === index; });

  var css = document.createElement('style');
  css.textContent = '.plan-day-list,.plan-editor,.plan-card{background:linear-gradient(145deg,#171717,#0d0d0d);border:1px solid var(--border-light);border-radius:20px;padding:16px;margin:0 0 14px}.plan-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.plan-eyebrow{color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.12em}.plan-heading{font-size:22px;font-weight:800;margin:4px 0 12px}.plan-day-link{display:flex;align-items:center;gap:12px;width:100%;padding:14px 2px;border:0;border-top:1px solid var(--border);background:none;color:var(--text);text-align:left}.plan-day-name{width:88px;font-weight:700}.plan-day-workout{flex:1;color:var(--text-muted);font-size:13px}.plan-day-arrow{font-size:25px;color:var(--accent);line-height:1}.plan-field{width:100%;min-width:0;background:var(--bg-subtle);color:var(--text);border:1px solid var(--border-light);border-radius:10px;padding:11px;font:inherit}.plan-edit-row{display:grid;grid-template-columns:minmax(0,1fr) 56px 72px 48px;gap:6px;align-items:center;padding:11px 0;border-top:1px solid var(--border)}.plan-edit-row input{min-width:0;padding:9px 3px;text-align:center}.plan-search-results{max-height:250px;overflow:auto;border:1px solid var(--border);border-radius:12px;margin-top:6px}.plan-search-results:empty{display:none}.plan-search-results button{width:100%;background:transparent;color:var(--text);border:0;border-bottom:1px solid var(--border);text-align:left;padding:12px}.plan-search-results small{display:block;color:var(--text-muted);margin-top:3px}.plan-image-preview{display:block;width:100%;height:150px;object-fit:cover;border-radius:14px;margin:10px 0;border:1px solid var(--border)}.plan-actions{display:flex;gap:8px;margin-top:12px}.plan-actions>*{flex:1}.plan-empty{padding:14px 0;color:var(--text-muted);font-size:13px}.account-card{background:linear-gradient(145deg,#191919,#0e0e0e);border:1px solid var(--border-light);border-radius:18px;padding:17px;margin-bottom:14px}.account-card label{display:block;font-size:12px;color:var(--text-muted);margin-top:12px}.account-card .input-field{display:block;box-sizing:border-box;width:100%;min-height:46px;margin-top:5px}.account-card small,.account-copy{color:var(--text-muted);font-size:13px;line-height:1.5}.account-actions{display:flex;gap:8px;margin-top:14px}.account-actions button{flex:1;min-height:46px}.cloud-status{font-size:12px;color:var(--accent);padding:0 2px 8px}.social-section{background:linear-gradient(145deg,#171717,#0d0d0d);border:1px solid var(--border);border-radius:18px;padding:16px;margin-bottom:14px}.friend-list{margin-top:12px}.friend-row,.leader-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-top:1px solid var(--border);font-size:13px}.leader-rank{font-size:12px;color:var(--accent);font-weight:800;width:25px}.leader-name{flex:1}.leader-weight{text-align:right;font-weight:700}.leader-row small,.friend-row small{display:block;color:var(--text-muted);font-size:11px;margin-top:3px}@media(max-width:420px){.plan-edit-row{grid-template-columns:minmax(0,1fr) 46px 62px 34px;gap:4px}.plan-edit-row button{min-width:32px;padding:7px 2px}.account-actions{flex-direction:column}}';
  document.head.appendChild(css);
  var polish = document.createElement('style');
  polish.textContent = ':root{--bg:#151513;--bg-subtle:#1c1b19;--surface:#22211f;--surface-2:#292825;--surface-3:#34322f;--border:#393733;--border-light:#494640;--text:#f0eee8;--text-muted:#aaa69c;--text-dim:#77736a}html{background:#151513}body{background-color:var(--bg);background-image:radial-gradient(ellipse 120% 55% at 50% -8%,rgba(255,255,255,.08),transparent 70%),linear-gradient(180deg,#242321 0%,#191918 55%,#151513 100%)}.plan-day-list,.plan-editor,.plan-card,.social-section,.account-card{background:linear-gradient(145deg,#252421,#1d1c1a);border-color:#403e39;box-shadow:0 10px 26px rgba(0,0,0,.12)}.plan-day-link{box-sizing:border-box;min-height:58px;width:100%;padding:12px 0 12px 2px;gap:8px}.plan-day-name{flex:0 0 82px;width:auto}.plan-day-workout{min-width:0;overflow-wrap:anywhere}.plan-day-arrow{flex:0 0 28px;text-align:center;margin:0;color:var(--text-muted)}.plan-picker{margin:8px 0 16px}.plan-picker-trigger{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:12px 14px;text-align:left;color:var(--text);background:#2b2a27;border:1px solid #504d46;border-radius:14px;font:inherit}.plan-picker-trigger:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.plan-picker-value{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.plan-picker-chevron{flex:0 0 24px;text-align:center;font-size:22px;line-height:1;color:var(--text-muted)}.plan-picker-list{display:none;max-height:245px;margin-top:8px;padding:5px;overflow-y:auto;overscroll-behavior:contain;background:#242320;border:1px solid #45423d;border-radius:14px}.plan-picker.is-open .plan-picker-list{display:block}.plan-picker-option{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:46px;padding:10px 12px;color:var(--text);text-align:left;background:transparent;border:0;border-radius:9px;font:inherit}.plan-picker-option+.plan-picker-option{border-top:1px solid rgba(255,255,255,.06)}.plan-picker-option.is-selected{background:#36342f;color:#fff}.plan-picker-option span:last-child{color:var(--text-muted)}.plan-exercise-search{scroll-margin-top:12px;text-align:left}.plan-exercise-list{max-height:34dvh;min-height:140px;margin-top:8px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.plan-exercise-option{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:52px;padding:9px 12px}.plan-exercise-option span:first-child{min-width:0}.plan-exercise-option b{display:block;font-size:13px}.plan-exercise-option small{font-size:11px}.plan-exercise-option .added-tag{flex:none;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}.plan-exercise-option:disabled{opacity:.62;cursor:default}.plan-edit-row{grid-template-columns:minmax(0,1fr) 50px 66px 36px;gap:6px;align-items:center;padding:12px 10px;border-top:1px solid var(--border);position:relative;background:transparent;cursor:grab;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:pan-y;transition:transform .15s ease, background .15s ease}.plan-edit-row:active{cursor:grabbing}.plan-edit-row input,.plan-edit-row button{cursor:auto;user-select:auto;-webkit-user-select:auto}.plan-edit-row.plan-dragging{background:var(--surface-3);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.6);z-index:50;opacity:0.96}.plan-edit-row.plan-drag-over{border-top:2px solid var(--accent)}.plan-move-hint{margin:4px 0 10px;font-size:11px;color:var(--text-muted)}.plan-rename-button{min-height:42px;padding:0 12px;border:1px solid #504d46;border-radius:12px;background:#2b2a27;color:var(--text);font-size:12px;font-weight:700;cursor:pointer}.plan-rename-button:active{background:#3a3833}.plan-edit-row b{overflow-wrap:anywhere}.account-card label{display:block!important;margin-top:13px}.account-card .input-field{display:block;box-sizing:border-box;width:100%;min-height:48px;margin:6px 0 0;text-align:left}.account-actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.account-actions button{width:100%;min-width:0}.friend-add-row{display:grid;grid-template-columns:minmax(0,1fr) 76px;align-items:stretch;gap:9px}.friend-add-row .input-field{width:100%;min-width:0;text-align:left}.friend-add-row .btn-primary{width:100%;padding:12px}.leader-row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;align-items:center;gap:9px}.leader-name{min-width:0;overflow-wrap:anywhere}.leader-weight{white-space:nowrap}.settings-account-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}.settings-account-actions button{min-width:0}.keyboard-open .plan-exercise-list{scroll-margin-bottom:12px}@media(max-width:440px){.plan-day-name{flex-basis:72px}.plan-edit-row{grid-template-columns:minmax(0,1fr) 44px 60px 34px;gap:4px;padding:11px 4px}.plan-edit-row button{min-width:32px;padding:7px 2px}.plan-exercise-list{max-height:32dvh}.account-actions,.settings-account-actions{grid-template-columns:1fr}}';
  document.head.appendChild(polish);
  var libraryStyle = document.createElement('style');
  libraryStyle.textContent = '.plan-library-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.plan-library-head .plan-heading{margin-bottom:0}.plan-library-list{display:grid;gap:9px;margin-top:14px}.plan-workout-card{display:flex;align-items:center;gap:12px;width:100%;min-height:70px;padding:12px 14px;border:1px solid #44413b;border-radius:15px;background:linear-gradient(145deg,#2a2925,#22211f);color:var(--text);text-align:left}.plan-workout-card:active{background:#34322e}.plan-workout-mark{display:grid;place-items:center;width:42px;height:42px;flex:none;border-radius:13px;background:#3a3832;color:var(--text);font-size:17px;font-weight:800}.plan-workout-copy{flex:1;min-width:0}.plan-workout-copy b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.plan-workout-copy small{display:block;margin-top:3px;color:var(--text-muted);font-size:12px}.plan-workout-arrow{color:var(--text-dim);font-size:24px}.plan-create-button{width:100%;min-height:52px;margin-top:12px;border:1px solid #555149;border-radius:14px;background:#efede6;color:#171614;font-size:14px;font-weight:800}.plan-library-empty{padding:18px 4px;color:var(--text-muted);font-size:13px;line-height:1.5}.plan-library-empty b{display:block;margin-bottom:4px;color:var(--text);font-size:14px}.plan-routine-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0 14px}.plan-delete-button{min-height:42px;padding:0 12px;border:1px solid rgba(208,89,74,.36);border-radius:12px;background:rgba(208,89,74,.08);color:#e68b7e;font-size:12px;font-weight:700}.plan-routine-open{width:100%;margin-top:8px}.workout-create-overlay{position:fixed;inset:0;z-index:500;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(10,10,9,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.workout-create-overlay.is-open{display:flex}.workout-create-sheet{width:min(100%,420px);padding:22px;border:1px solid #4c4942;border-radius:24px;background:linear-gradient(150deg,#2b2a27,#201f1d);box-shadow:0 25px 80px rgba(0,0,0,.5);animation:fadeIn .16s ease}.workout-create-sheet h2{margin:6px 0 6px;font-size:25px}.workout-create-sheet p{margin:0 0 18px;color:var(--text-muted);font-size:13px;line-height:1.5}.workout-create-sheet label{display:block;margin-bottom:7px;color:var(--text-muted);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.workout-create-sheet input{width:100%;min-height:52px;padding:0 14px;border:1px solid #555149;border-radius:14px;background:#191816;color:var(--text);font:inherit}.workout-create-sheet input:focus{outline:2px solid rgba(241,238,230,.45);outline-offset:2px}.workout-create-error{display:block;min-height:18px;margin-top:6px;color:#e68b7e;font-size:12px}.workout-create-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:18px}.workout-create-actions button{min-height:48px}.plan-day-current{padding:15px;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.025)}.plan-day-current b{display:block;font-size:16px}.plan-day-current small{color:var(--text-muted)}';
  document.head.appendChild(libraryStyle);
  var muscleStyle = document.createElement('style');
  muscleStyle.textContent = '.plan-muscle-filters{display:flex;gap:7px;overflow-x:auto;padding:9px 1px 5px;margin:0 -1px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.plan-muscle-filters::-webkit-scrollbar{display:none}.plan-muscle-filter{flex:none;min-height:38px;padding:0 13px;border:1px solid var(--border-light);border-radius:22px;background:var(--surface);color:var(--text-muted);font:inherit;font-size:12px;font-weight:700}.plan-muscle-filter.is-active{background:#efede6;color:#171614;border-color:#efede6}.plan-library-count{padding:4px 2px;color:var(--text-muted);font-size:11px}';
  document.head.appendChild(muscleStyle);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
  function names() { return Object.keys(window.WORKOUTS || {}); }
  function deletedNames() { try { return JSON.parse(localStorage.getItem('gymDeletedWorkouts') || '[]'); } catch (e) { return []; } }
  function saveDeletedNames(list) { localStorage.setItem('gymDeletedWorkouts', JSON.stringify(list)); }
  function restoredNames() { try { return JSON.parse(localStorage.getItem('gymRestoredWorkouts') || '[]'); } catch (e) { return []; } }
  function saveRestoredNames(list) { localStorage.setItem('gymRestoredWorkouts', JSON.stringify(list)); }
  function save() {
    localStorage.setItem('gymCustomWorkouts', JSON.stringify(window.WORKOUTS || {}));
    localStorage.setItem('gymPlanSchedule', JSON.stringify(window.SCHEDULE || {}));
    window.dispatchEvent(new Event('gym:plan-changed'));
    if (window.renderToday) window.renderToday();
  }
  function restImage() { return localStorage.getItem('gymRestImage') || 'rest.png'; }
  function setImage(data) {
    localStorage.setItem('gymRestImage', data);
    document.querySelectorAll('.rest-pic,.up-thumb').forEach(function (img) { img.src = data; });
    window.dispatchEvent(new Event('gym:plan-changed'));
  }
  function dayRows() {
    return days.map(function (day, i) {
      var workout = window.SCHEDULE[i];
      return '<button class="plan-day-link" type="button" data-open-day="' + i + '"><span class="plan-day-name">' + day + '</span><span class="plan-day-workout">' + esc(workout || 'Rest day') + '</span><span class="plan-day-arrow" aria-hidden="true">›</span></button>';
    }).join('');
  }
  function renderWeek() {
    var routines = names();
    root.innerHTML = '<section class="plan-day-list"><div class="plan-eyebrow">Your schedule</div><h2 class="plan-heading">Your week</h2>' + dayRows() + '</section>' +
      '<section class="plan-card"><div class="plan-library-head"><div><div class="plan-eyebrow">Build your routine</div><h2 class="plan-heading">My workouts</h2></div></div>' +
      (routines.length ? '<div class="plan-library-list">' + routines.map(function (n) { var count = (window.WORKOUTS[n] || []).length, scheduled = Object.keys(window.SCHEDULE).filter(function (k) { return window.SCHEDULE[k] === n; }).length; return '<button class="plan-workout-card" type="button" data-edit-workout="' + esc(n) + '"><span class="plan-workout-mark" aria-hidden="true">' + esc(n.slice(0, 1).toUpperCase()) + '</span><span class="plan-workout-copy"><b>' + esc(n) + '</b><small>' + count + ' exercises · ' + (scheduled ? scheduled + (scheduled === 1 ? ' day' : ' days') : 'not scheduled') + '</small></span><span class="plan-workout-arrow" aria-hidden="true">›</span></button>'; }).join('') + '</div>' : '<div class="plan-library-empty"><b>Your workout list is ready.</b>Create a routine like Push, Pull, Legs, Upper or Lower, then add your exercises.</div>') +
      '<button id="newPlan" class="plan-create-button" type="button">＋ Create a workout</button></section>' +
      '<section class="plan-card"><div class="plan-eyebrow">Rest day image</div><img class="plan-image-preview" src="' + esc(restImage()) + '" alt="Rest day image preview"><div class="plan-actions"><button class="btn-secondary" type="button" id="chooseRestImage">Choose image</button><button class="btn-ghost" type="button" id="resetRestImage">Reset</button></div><input id="restImageFile" type="file" accept="image/*" hidden></section>' +
      '<div class="workout-create-overlay" id="workoutCreateModal"><form class="workout-create-sheet" id="workoutCreateForm" role="dialog" aria-modal="true" aria-labelledby="workoutCreateTitle"><div class="plan-eyebrow">Your training plan</div><h2 id="workoutCreateTitle">Create a workout</h2><p>Give this routine a name. You can add exercises and put it on any day next.</p><label for="workoutNameInput">Workout name</label><input id="workoutNameInput" maxlength="40" placeholder="For example, Push day" autocomplete="off"><small id="workoutCreateError" class="workout-create-error" aria-live="polite"></small><div class="workout-create-actions"><button id="cancelCreateWorkout" class="btn-ghost" type="button">Cancel</button><button class="plan-create-button" type="submit" style="margin:0">Create workout</button></div></form></div>';
    root.querySelectorAll('[data-open-day]').forEach(function (b) { b.onclick = function () { selectedDay = +b.dataset.openDay; render(); }; });
    root.querySelectorAll('[data-edit-workout]').forEach(function (b) { b.onclick = function () { selectedWorkout = b.dataset.editWorkout; render(); }; });
    document.getElementById('newPlan').onclick = function () { document.getElementById('workoutCreateModal').classList.add('is-open'); setTimeout(function () { document.getElementById('workoutNameInput').focus(); }, 40); };
    document.getElementById('cancelCreateWorkout').onclick = function () { document.getElementById('workoutCreateModal').classList.remove('is-open'); };
    document.getElementById('workoutCreateModal').onclick = function (event) { if (event.target === this) this.classList.remove('is-open'); };
    document.getElementById('workoutCreateForm').onsubmit = function (event) { event.preventDefault(); createPlan(); };
    document.getElementById('chooseRestImage').onclick = function () { document.getElementById('restImageFile').click(); };
    document.getElementById('resetRestImage').onclick = function () { localStorage.removeItem('gymRestImage'); setImage('rest.png'); render(); };
    document.getElementById('restImageFile').onchange = function () {
      var file = this.files && this.files[0]; if (!file || !file.type.startsWith('image/')) return;
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image(); img.onload = function () {
          var scale = Math.min(1, 1000 / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas'); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          try { setImage(canvas.toDataURL('image/jpeg', 0.82)); render(); } catch (e) { alert('That image could not be saved. Try a smaller image.'); }
        }; img.src = reader.result;
      }; reader.readAsDataURL(file);
    };
  }
  function renderDay() {
    var dayIndex = selectedDay, day = days[dayIndex], assigned = window.SCHEDULE[dayIndex] || '', ns = names();
    root.innerHTML = '<section class="plan-editor"><div class="plan-top"><button type="button" class="btn-ghost" id="backWeek">‹ My plan</button><span class="plan-eyebrow">' + day + '</span></div>' +
      '<label class="plan-eyebrow" for="dayWorkout">Workout</label><div class="plan-picker" id="planPicker"><button id="dayWorkout" class="plan-picker-trigger" type="button" aria-expanded="false" aria-controls="dayWorkoutOptions"><span class="plan-picker-value">' + esc(assigned || 'Rest day') + '</span><span class="plan-picker-chevron" aria-hidden="true">⌄</span></button><div class="plan-picker-list" id="dayWorkoutOptions" role="listbox"><button class="plan-picker-option ' + (!assigned ? 'is-selected' : '') + '" type="button" role="option" data-workout=""><span>Rest day</span><span>' + (!assigned ? '✓' : '') + '</span></button>' + ns.map(function (n) { return '<button class="plan-picker-option ' + (n === assigned ? 'is-selected' : '') + '" type="button" role="option" data-workout="' + esc(n) + '"><span>' + esc(n) + '</span><span>' + (n === assigned ? '✓' : '') + '</span></button>'; }).join('') + '</div></div>' +
      (assigned ? '<button class="plan-workout-card plan-routine-open" id="editAssignedWorkout" type="button"><span class="plan-workout-mark">' + esc(assigned.slice(0, 1).toUpperCase()) + '</span><span class="plan-workout-copy"><b>' + esc(assigned) + '</b><small>' + (window.WORKOUTS[assigned] || []).length + ' exercises · tap to edit</small></span><span class="plan-workout-arrow">›</span></button>' : '<div class="plan-library-empty">Choose one of your workouts for this day, or keep it as a rest day.</div>') +
      '</section>';
    document.getElementById('backWeek').onclick = function () { selectedDay = null; render(); };
    var picker = document.getElementById('planPicker'), pickerButton = document.getElementById('dayWorkout');
    pickerButton.onclick = function () { var open = picker.classList.toggle('is-open'); pickerButton.setAttribute('aria-expanded', String(open)); };
    picker.querySelectorAll('[data-workout]').forEach(function (option) { option.onclick = function () { window.SCHEDULE[dayIndex] = option.dataset.workout || null; save(); render(); }; });
    if (assigned) document.getElementById('editAssignedWorkout').onclick = function () { selectedWorkout = assigned; render(); };
  }
  function renderWorkoutEditor() {
    var name = selectedWorkout;
    if (!name || !window.WORKOUTS[name]) { selectedWorkout = null; render(); return; }
    var list = window.WORKOUTS[name];
    var exerciseRows = list.length ? list.map(function (e, i) {
      return '<div class="plan-edit-row" data-index="' + i + '" draggable="true">' +
        '<div class="plan-ex-info" style="min-width:0;pointer-events:none">' +
          '<b style="font-size:13px;line-height:1.25;display:block">' + esc(e.name) + '</b>' +
          (e.sides ? '<small style="display:block;color:var(--text-muted)">2 left + 2 right sets</small>' : '') +
        '</div>' +
        '<input class="plan-field" type="number" min="1" max="20" data-i="' + i + '" data-k="sets" value="' + (+e.sets || 2) + '" aria-label="Sets">' +
        '<input class="plan-field" data-i="' + i + '" data-k="target" value="' + esc(e.target || '8–12') + '" aria-label="Rep target">' +
        '<button class="btn-ghost danger" data-remove="' + i + '" aria-label="Remove ' + esc(e.name) + '">×</button>' +
      '</div>';
    }).join('') : '<div class="plan-library-empty"><b>Start with one exercise.</b>Use the list below to build this workout.</div>';

    var moveHint = list.length > 1 ? '<div class="plan-move-hint">Press and hold an exercise to drag and reorder.</div>' : '';

    root.innerHTML = '<section class="plan-editor"><div class="plan-top"><button type="button" class="btn-ghost" id="backWorkout">‹ ' + (selectedDay == null ? 'My workouts' : 'Day') + '</button><span class="plan-eyebrow">Workout builder</span></div>' +
      '<div class="plan-routine-actions"><div><h2 class="plan-heading" style="margin-bottom:3px">' + esc(name) + '</h2><span class="plan-eyebrow">' + list.length + (list.length === 1 ? ' exercise' : ' exercises') + '</span></div><div style="display:flex;gap:8px"><button class="plan-rename-button" id="renameWorkout" type="button">Rename</button><button class="plan-delete-button" id="deleteWorkout" type="button">Delete workout</button></div></div>' +
      '<label class="plan-eyebrow" for="exerciseSearch" style="display:block;margin-top:8px">Exercise library · ' + moves.length + ' exercises</label><div class="plan-muscle-filters" id="muscleFilters" aria-label="Filter by muscle group"></div><input id="exerciseSearch" class="plan-field plan-exercise-search" placeholder="Search exercises" autocomplete="off" enterkeyhint="search"><div class="plan-library-count" id="exerciseCount"></div><div class="plan-search-results plan-exercise-list" id="exerciseResults"></div>' +
      '<div class="plan-top" style="margin-top:20px"><h2 class="plan-heading">In this workout</h2></div>' + moveHint + exerciseRows + '</section>';

    function moveExercise(from, to) {
      if (from === to || to < 0 || to >= list.length) return;
      var item = list.splice(from, 1)[0];
      list.splice(to, 0, item);
      save();
      render();
    }

    document.getElementById('renameWorkout').onclick = function () {
      var n2 = (window.prompt('Rename workout:', name) || '').trim().slice(0, 40);
      if (!n2 || n2 === name) return;
      if (window.WORKOUTS[n2]) { alert('You already have a workout with that name.'); return; }
      var rebuilt = {};
      Object.keys(window.WORKOUTS).forEach(function (k) { rebuilt[k === name ? n2 : k] = window.WORKOUTS[k]; });
      Object.keys(window.WORKOUTS).forEach(function (k) { delete window.WORKOUTS[k]; });
      Object.keys(rebuilt).forEach(function (k) { window.WORKOUTS[k] = rebuilt[k]; });
      Object.keys(window.SCHEDULE).forEach(function (k) { if (window.SCHEDULE[k] === name) window.SCHEDULE[k] = n2; });
      var del = deletedNames(), res = restoredNames().filter(function (x) { return x !== name; });
      if (del.indexOf(name) < 0) del.push(name);
      if (del.indexOf(n2) >= 0) { del = del.filter(function (x) { return x !== n2; }); if (res.indexOf(n2) < 0) res.push(n2); }
      saveDeletedNames(del);
      saveRestoredNames(res);
      selectedWorkout = n2;
      save();
      render();
    };
    document.getElementById('backWorkout').onclick = function () { selectedWorkout = null; render(); };
    document.getElementById('deleteWorkout').onclick = function () {
      if (!window.confirm('Delete "' + name + '" from your workout list? Your saved workout history will stay.')) return;
      delete window.WORKOUTS[name];
      var deleted = deletedNames(); if (deleted.indexOf(name) < 0) deleted.push(name); saveDeletedNames(deleted);
      saveRestoredNames(restoredNames().filter(function (oldName) { return oldName !== name; }));
      Object.keys(window.SCHEDULE).forEach(function (k) { if (window.SCHEDULE[k] === name) window.SCHEDULE[k] = null; });
      selectedWorkout = null; selectedDay = null; save(); render();
    };

    // Drag and drop for the whole exercise card
    var dragSource = null;
    var rowEls = root.querySelectorAll('.plan-edit-row');

    rowEls.forEach(function (row) {
      // Desktop HTML5 drag
      row.addEventListener('dragstart', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
          e.preventDefault();
          return;
        }
        dragSource = +this.dataset.index;
        this.classList.add('plan-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(dragSource));
        }
      });
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        this.classList.add('plan-drag-over');
      });
      row.addEventListener('dragleave', function () {
        this.classList.remove('plan-drag-over');
      });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        this.classList.remove('plan-drag-over');
        var toIndex = +this.dataset.index;
        if (dragSource !== null && dragSource !== toIndex) {
          moveExercise(dragSource, toIndex);
        }
        dragSource = null;
      });
      row.addEventListener('dragend', function () {
        this.classList.remove('plan-dragging');
        rowEls.forEach(function (r) { r.classList.remove('plan-drag-over'); });
        dragSource = null;
      });

      // Mobile touch drag (press and hold 160ms on any non-input part of the row)
      var touchTimer = null;
      var isDragging = false;
      var startY = 0;
      var startX = 0;
      var startIndex = -1;
      var targetIndex = -1;
      var rowHeight = 0;
      var rowsArray = [];

      function cancelTouch() {
        if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
      }

      row.addEventListener('touchstart', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        if (e.touches.length !== 1) return;

        var touch = e.touches[0];
        startY = touch.clientY;
        startX = touch.clientX;
        startIndex = +row.dataset.index;
        targetIndex = startIndex;

        cancelTouch();
        touchTimer = setTimeout(function () {
          touchTimer = null;
          isDragging = true;
          rowsArray = Array.prototype.slice.call(root.querySelectorAll('.plan-edit-row'));
          rowHeight = row.offsetHeight || 50;

          row.classList.add('plan-dragging');
          if (navigator.vibrate) {
            try { navigator.vibrate(25); } catch (_) {}
          }
        }, 160);
      }, { passive: true });

      row.addEventListener('touchmove', function (e) {
        var touch = e.touches[0];
        if (!isDragging) {
          if (touchTimer && (Math.abs(touch.clientY - startY) > 8 || Math.abs(touch.clientX - startX) > 8)) {
            cancelTouch();
          }
          return;
        }

        if (e.cancelable) e.preventDefault();

        var dy = touch.clientY - startY;
        row.style.transform = 'translateY(' + dy + 'px)';

        var deltaIndex = Math.round(dy / rowHeight);
        var newTarget = Math.max(0, Math.min(rowsArray.length - 1, startIndex + deltaIndex));

        if (newTarget !== targetIndex) {
          targetIndex = newTarget;
          rowsArray.forEach(function (r, idx) {
            if (idx === startIndex) return;
            var shift = 0;
            if (startIndex < targetIndex && idx > startIndex && idx <= targetIndex) shift = -rowHeight;
            if (startIndex > targetIndex && idx >= targetIndex && idx < startIndex) shift = rowHeight;
            r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
            r.style.transition = 'transform 0.15s ease';
          });
        }

        if (touch.clientY < 90) window.scrollBy(0, -10);
        else if (touch.clientY > window.innerHeight - 90) window.scrollBy(0, 10);
      }, { passive: false });

      function endTouch() {
        cancelTouch();
        if (!isDragging) return;
        isDragging = false;

        row.classList.remove('plan-dragging');
        rowsArray.forEach(function (r) {
          r.style.transform = '';
          r.style.transition = '';
        });

        if (targetIndex !== -1 && targetIndex !== startIndex) {
          moveExercise(startIndex, targetIndex);
        }
      }

      row.addEventListener('touchend', endTouch);
      row.addEventListener('touchcancel', endTouch);
    });

    root.querySelectorAll('[data-remove]').forEach(function (b) { b.onclick = function () { list.splice(+b.dataset.remove, 1); save(); render(); }; });
    root.querySelectorAll('[data-k]').forEach(function (input) { input.onchange = function () { var e = list[+this.dataset.i]; e[this.dataset.k] = this.dataset.k === 'sets' ? Math.max(1, Math.min(20, +this.value || 2)) : this.value; save(); }; });
    var search = document.getElementById('exerciseSearch'), results = document.getElementById('exerciseResults');
    var filters = document.getElementById('muscleFilters'), count = document.getElementById('exerciseCount');
    var groups = ['All', 'Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core', 'Conditioning'];
    filters.innerHTML = groups.map(function (group) { return '<button class="plan-muscle-filter ' + (group === selectedMuscle ? 'is-active' : '') + '" type="button" data-muscle="' + group + '">' + group + '</button>'; }).join('');
    filters.querySelectorAll('[data-muscle]').forEach(function (button) { button.onclick = function () { selectedMuscle = button.dataset.muscle; filters.querySelectorAll('[data-muscle]').forEach(function (item) { item.classList.toggle('is-active', item === button); }); showResults(); }; });
    function showResults() {
      var q = search.value.toLowerCase();
      var filtered = moves.filter(function (x) { return (selectedMuscle === 'All' || muscleGroups[x.cat] === selectedMuscle) && (!q || x.name.toLowerCase().includes(q) || x.cat.includes(q) || muscleGroups[x.cat].toLowerCase().includes(q)); });
      count.textContent = filtered.length + ' exercises' + (selectedMuscle === 'All' ? '' : ' · ' + selectedMuscle);
      results.innerHTML = filtered.length ? filtered.map(function (x) { var added = list.some(function (e) { return e.name === x.name; }); var sides = unilateral.test(x.name); return '<button class="plan-exercise-option" type="button" data-add-ex="' + esc(x.name) + '" ' + (added ? 'disabled' : '') + '><span><b>' + esc(x.name) + '</b><small>' + esc(muscleGroups[x.cat] || x.cat) + (sides ? ' · Left + right' : '') + '</small></span><span class="added-tag">' + (added ? 'Added' : '＋ Add') + '</span></button>'; }).join('') : '<div class="plan-empty">No matching exercises</div>';
      results.querySelectorAll('[data-add-ex]').forEach(function (b) { b.onclick = function () { var move = moves.find(function (x) { return x.name === b.dataset.addEx; }); var sides = unilateral.test(move.name); list.push({ name: move.name, cat: move.cat, sets: sides ? 4 : 2, sides: sides ? 'both' : undefined, target: '8–12', rest: 90, note: '' }); save(); render(); }; });
    }
    search.oninput = showResults;
    function fitExerciseList() {
      var vv = window.visualViewport, viewHeight = vv ? vv.height : window.innerHeight;
      var top = search.getBoundingClientRect().top;
      results.style.maxHeight = Math.max(112, Math.min(340, viewHeight - Math.max(12, top) - 150)) + 'px';
    }
    search.onfocus = function () {
      showResults();
      fitExerciseList();
      window.setTimeout(function () { search.scrollIntoView({ block: 'start', behavior: 'smooth' }); fitExerciseList(); }, 240);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', fitExerciseList);
      document.body.classList.add('keyboard-open');
    };
    search.onblur = function () {
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', fitExerciseList);
      document.body.classList.remove('keyboard-open');
    };
    showResults();
  }
  function render() {
    if (!root) return;
    if (selectedWorkout != null) renderWorkoutEditor();
    else if (selectedDay == null) renderWeek();
    else renderDay();
  }
  function createPlan() {
    var input = document.getElementById('workoutNameInput'), n = input && input.value.trim();
    var error = document.getElementById('workoutCreateError');
    if (!n) { if (error) error.textContent = 'Add a name for this workout.'; return; }
    if (window.WORKOUTS[n]) { if (error) error.textContent = 'You already have a workout with that name.'; input.focus(); return; }
    var deletedBefore = deletedNames();
    if (deletedBefore.indexOf(n) >= 0) saveRestoredNames(Array.from(new Set(restoredNames().concat([n]))));
    saveDeletedNames(deletedBefore.filter(function (oldName) { return oldName !== n; }));
    window.WORKOUTS[n] = [];
    var modal = document.getElementById('workoutCreateModal'); if (modal) modal.classList.remove('is-open');
    save();
    selectedWorkout = n;
    render();
  }
  window.openPlanWorkout = function (name, date) {
    if (window.startSession) window.startSession(name, date);
  };
  document.addEventListener('click', function (event) {
    var picker = document.getElementById('planPicker');
    if (picker && !picker.contains(event.target)) {
      picker.classList.remove('is-open');
      document.getElementById('dayWorkout').setAttribute('aria-expanded', 'false');
    }
  });
  window.renderPlan = render;
  window.addEventListener('gym:plan-loaded', function () { window.renderPlan(); });
  window.renderPlan();
})();
