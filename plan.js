/* Weekly plan editor, workout navigation, and rest-day image settings. */
(function () {
  'use strict';

  var root = document.getElementById('planRoot');
  var days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var selectedDay = null;
  var selectedWorkout = null;
  var moves = [
    ['Barbell Back Squat','quads'],['Front Squat','quads'],['Goblet Squat','quads'],['Bulgarian Split Squat','quads'],['Walking Lunge','quads'],['Reverse Lunge','quads'],['Leg Press','quads'],['Hack Squat','quads'],['Leg Extension','quads'],['Step-up','quads'],['Sissy Squat','quads'],
    ['Romanian Deadlift','hamstrings'],['Conventional Deadlift','back'],['Sumo Deadlift','hamstrings'],['Hip Thrust','hips'],['Glute Bridge','hips'],['Leg Curl','hamstrings'],['Seated Leg Curl','hamstrings'],['Good Morning','hamstrings'],['Back Extension','back'],['Standing Calf Raise','calves'],['Seated Calf Raise','calves'],
    ['Barbell Bench Press','chest'],['Incline Barbell Press','chest'],['Incline Dumbbell Press','chest'],['Dumbbell Floor Press','chest'],['Push-up','chest'],['Cable Fly','chest'],['Pec Deck','chest'],['Chest Press Machine','chest'],['Dips','chest'],
    ['Overhead Press','shoulders'],['Dumbbell Lateral Raise','shoulders'],['Cable Lateral Raise','shoulders'],['Face Pull','shoulders'],['Rear Delt Fly','shoulders'],['Arnold Press','shoulders'],['Upright Row','shoulders'],
    ['Pull-up','back'],['Chin-up','back'],['Lat Pulldown','back'],['Close-grip Lat Pulldown','back'],['Barbell Row','back'],['One-arm Dumbbell Row','back'],['Seated Cable Row','back'],['Chest-supported Row','back'],['T-Bar Row','back'],['Straight-arm Pulldown','back'],['Shrug','back'],
    ['Dumbbell Curl','biceps'],['Hammer Curl','biceps'],['Preacher Curl','biceps'],['Cable Curl','biceps'],['Concentration Curl','biceps'],['Triceps Pushdown','triceps'],['Overhead Triceps Extension','triceps'],['Skull Crusher','triceps'],['Close-grip Bench Press','triceps'],
    ['Plank','abs'],['Side Plank','abs'],['Hanging Leg Raise','abs'],['Cable Crunch','abs'],['Ab Wheel Rollout','abs'],['Pallof Press','abs'],['Russian Twist','abs'],['Farmer Carry','forearms'],['Hip Abduction','hips'],['Hip Adduction','hips'],['Jump Rope','conditioning'],['Burpee','conditioning'],['Mountain Climber','conditioning'],['Treadmill Run','conditioning'],['Cycling','conditioning']
  ].map(function (x) { return { name: x[0], cat: x[1] }; });

  var css = document.createElement('style');
  css.textContent = '.plan-day-list,.plan-editor,.plan-card{background:linear-gradient(145deg,#171717,#0d0d0d);border:1px solid var(--border-light);border-radius:20px;padding:16px;margin:0 0 14px}.plan-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.plan-eyebrow{color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.12em}.plan-heading{font-size:22px;font-weight:800;margin:4px 0 12px}.plan-day-link{display:flex;align-items:center;gap:12px;width:100%;padding:14px 2px;border:0;border-top:1px solid var(--border);background:none;color:var(--text);text-align:left}.plan-day-name{width:88px;font-weight:700}.plan-day-workout{flex:1;color:var(--text-muted);font-size:13px}.plan-day-arrow{font-size:25px;color:var(--accent);line-height:1}.plan-field{width:100%;min-width:0;background:var(--bg-subtle);color:var(--text);border:1px solid var(--border-light);border-radius:10px;padding:11px;font:inherit}.plan-edit-row{display:grid;grid-template-columns:minmax(0,1fr) 56px 72px 48px;gap:6px;align-items:center;padding:11px 0;border-top:1px solid var(--border)}.plan-edit-row input{min-width:0;padding:9px 3px;text-align:center}.plan-search-results{max-height:250px;overflow:auto;border:1px solid var(--border);border-radius:12px;margin-top:6px}.plan-search-results:empty{display:none}.plan-search-results button{width:100%;background:transparent;color:var(--text);border:0;border-bottom:1px solid var(--border);text-align:left;padding:12px}.plan-search-results small{display:block;color:var(--text-muted);margin-top:3px}.plan-image-preview{display:block;width:100%;height:150px;object-fit:cover;border-radius:14px;margin:10px 0;border:1px solid var(--border)}.plan-actions{display:flex;gap:8px;margin-top:12px}.plan-actions>*{flex:1}.plan-empty{padding:14px 0;color:var(--text-muted);font-size:13px}.account-card{background:linear-gradient(145deg,#191919,#0e0e0e);border:1px solid var(--border-light);border-radius:18px;padding:17px;margin-bottom:14px}.account-card label{display:block;font-size:12px;color:var(--text-muted);margin-top:12px}.account-card .input-field{display:block;box-sizing:border-box;width:100%;min-height:46px;margin-top:5px}.account-card small,.account-copy{color:var(--text-muted);font-size:13px;line-height:1.5}.account-actions{display:flex;gap:8px;margin-top:14px}.account-actions button{flex:1;min-height:46px}.cloud-status{font-size:12px;color:var(--accent);padding:0 2px 8px}.social-section{background:linear-gradient(145deg,#171717,#0d0d0d);border:1px solid var(--border);border-radius:18px;padding:16px;margin-bottom:14px}.friend-list{margin-top:12px}.friend-row,.leader-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-top:1px solid var(--border);font-size:13px}.leader-rank{font-size:12px;color:var(--accent);font-weight:800;width:25px}.leader-name{flex:1}.leader-weight{text-align:right;font-weight:700}.leader-row small,.friend-row small{display:block;color:var(--text-muted);font-size:11px;margin-top:3px}@media(max-width:420px){.plan-edit-row{grid-template-columns:minmax(0,1fr) 46px 62px 34px;gap:4px}.plan-edit-row button{min-width:32px;padding:7px 2px}.account-actions{flex-direction:column}}';
  document.head.appendChild(css);
  var polish = document.createElement('style');
  polish.textContent = ':root{--bg:#151513;--bg-subtle:#1c1b19;--surface:#22211f;--surface-2:#292825;--surface-3:#34322f;--border:#393733;--border-light:#494640;--text:#f0eee8;--text-muted:#aaa69c;--text-dim:#77736a}html{background:#151513}body{background-color:var(--bg);background-image:radial-gradient(ellipse 120% 55% at 50% -8%,rgba(255,255,255,.08),transparent 70%),linear-gradient(180deg,#242321 0%,#191918 55%,#151513 100%)}.plan-day-list,.plan-editor,.plan-card,.social-section,.account-card{background:linear-gradient(145deg,#252421,#1d1c1a);border-color:#403e39;box-shadow:0 10px 26px rgba(0,0,0,.12)}.plan-day-link{box-sizing:border-box;min-height:58px;width:100%;padding:12px 0 12px 2px;gap:8px}.plan-day-name{flex:0 0 82px;width:auto}.plan-day-workout{min-width:0;overflow-wrap:anywhere}.plan-day-arrow{flex:0 0 28px;text-align:center;margin:0;color:var(--text-muted)}.plan-picker{margin:8px 0 16px}.plan-picker-trigger{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:12px 14px;text-align:left;color:var(--text);background:#2b2a27;border:1px solid #504d46;border-radius:14px;font:inherit}.plan-picker-trigger:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.plan-picker-value{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.plan-picker-chevron{flex:0 0 24px;text-align:center;font-size:22px;line-height:1;color:var(--text-muted)}.plan-picker-list{display:none;max-height:245px;margin-top:8px;padding:5px;overflow-y:auto;overscroll-behavior:contain;background:#242320;border:1px solid #45423d;border-radius:14px}.plan-picker.is-open .plan-picker-list{display:block}.plan-picker-option{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:46px;padding:10px 12px;color:var(--text);text-align:left;background:transparent;border:0;border-radius:9px;font:inherit}.plan-picker-option+.plan-picker-option{border-top:1px solid rgba(255,255,255,.06)}.plan-picker-option.is-selected{background:#36342f;color:#fff}.plan-picker-option span:last-child{color:var(--text-muted)}.plan-exercise-search{scroll-margin-top:12px;text-align:left}.plan-exercise-list{max-height:34dvh;min-height:140px;margin-top:8px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.plan-exercise-option{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:52px;padding:9px 12px}.plan-exercise-option span:first-child{min-width:0}.plan-exercise-option b{display:block;font-size:13px}.plan-exercise-option small{font-size:11px}.plan-exercise-option .added-tag{flex:none;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}.plan-exercise-option:disabled{opacity:.62;cursor:default}.plan-edit-row{grid-template-columns:minmax(0,1fr) 50px 66px 36px;gap:6px}.plan-edit-row b{overflow-wrap:anywhere}.account-card label{display:block!important;margin-top:13px}.account-card .input-field{display:block;box-sizing:border-box;width:100%;min-height:48px;margin:6px 0 0;text-align:left}.account-actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.account-actions button{width:100%;min-width:0}.friend-add-row{display:grid;grid-template-columns:minmax(0,1fr) 76px;align-items:stretch;gap:9px}.friend-add-row .input-field{width:100%;min-width:0;text-align:left}.friend-add-row .btn-primary{width:100%;padding:12px}.leader-row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;align-items:center;gap:9px}.leader-name{min-width:0;overflow-wrap:anywhere}.leader-weight{white-space:nowrap}.settings-account-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}.settings-account-actions button{min-width:0}.keyboard-open .plan-exercise-list{scroll-margin-bottom:12px}@media(max-width:440px){.plan-day-name{flex-basis:72px}.plan-edit-row{grid-template-columns:minmax(0,1fr) 44px 60px 34px;gap:4px}.plan-edit-row button{min-width:32px;padding:7px 2px}.plan-exercise-list{max-height:32dvh}.account-actions,.settings-account-actions{grid-template-columns:1fr}}';
  document.head.appendChild(polish);
  var libraryStyle = document.createElement('style');
  libraryStyle.textContent = '.plan-library-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.plan-library-head .plan-heading{margin-bottom:0}.plan-library-list{display:grid;gap:9px;margin-top:14px}.plan-workout-card{display:flex;align-items:center;gap:12px;width:100%;min-height:70px;padding:12px 14px;border:1px solid #44413b;border-radius:15px;background:linear-gradient(145deg,#2a2925,#22211f);color:var(--text);text-align:left}.plan-workout-card:active{background:#34322e}.plan-workout-mark{display:grid;place-items:center;width:42px;height:42px;flex:none;border-radius:13px;background:#3a3832;color:var(--text);font-size:17px;font-weight:800}.plan-workout-copy{flex:1;min-width:0}.plan-workout-copy b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.plan-workout-copy small{display:block;margin-top:3px;color:var(--text-muted);font-size:12px}.plan-workout-arrow{color:var(--text-dim);font-size:24px}.plan-create-button{width:100%;min-height:52px;margin-top:12px;border:1px solid #555149;border-radius:14px;background:#efede6;color:#171614;font-size:14px;font-weight:800}.plan-library-empty{padding:18px 4px;color:var(--text-muted);font-size:13px;line-height:1.5}.plan-library-empty b{display:block;margin-bottom:4px;color:var(--text);font-size:14px}.plan-routine-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0 14px}.plan-delete-button{min-height:42px;padding:0 12px;border:1px solid rgba(208,89,74,.36);border-radius:12px;background:rgba(208,89,74,.08);color:#e68b7e;font-size:12px;font-weight:700}.plan-routine-open{width:100%;margin-top:8px}.workout-create-overlay{position:fixed;inset:0;z-index:500;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(10,10,9,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.workout-create-overlay.is-open{display:flex}.workout-create-sheet{width:min(100%,420px);padding:22px;border:1px solid #4c4942;border-radius:24px;background:linear-gradient(150deg,#2b2a27,#201f1d);box-shadow:0 25px 80px rgba(0,0,0,.5);animation:fadeIn .16s ease}.workout-create-sheet h2{margin:6px 0 6px;font-size:25px}.workout-create-sheet p{margin:0 0 18px;color:var(--text-muted);font-size:13px;line-height:1.5}.workout-create-sheet label{display:block;margin-bottom:7px;color:var(--text-muted);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.workout-create-sheet input{width:100%;min-height:52px;padding:0 14px;border:1px solid #555149;border-radius:14px;background:#191816;color:var(--text);font:inherit}.workout-create-sheet input:focus{outline:2px solid rgba(241,238,230,.45);outline-offset:2px}.workout-create-error{display:block;min-height:18px;margin-top:6px;color:#e68b7e;font-size:12px}.workout-create-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:18px}.workout-create-actions button{min-height:48px}.plan-day-current{padding:15px;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.025)}.plan-day-current b{display:block;font-size:16px}.plan-day-current small{color:var(--text-muted)}';
  document.head.appendChild(libraryStyle);

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
    var exerciseRows = list.length ? list.map(function (e, i) { return '<div class="plan-edit-row"><b style="font-size:12px;line-height:1.25">' + esc(e.name) + '</b><input class="plan-field" type="number" min="1" max="20" data-i="' + i + '" data-k="sets" value="' + (+e.sets || 3) + '" aria-label="Sets"><input class="plan-field" data-i="' + i + '" data-k="target" value="' + esc(e.target || '8–12') + '" aria-label="Rep target"><button class="btn-ghost danger" data-remove="' + i + '" aria-label="Remove ' + esc(e.name) + '">×</button></div>'; }).join('') : '<div class="plan-library-empty"><b>Start with one exercise.</b>Use the list below to build this workout.</div>';
    root.innerHTML = '<section class="plan-editor"><div class="plan-top"><button type="button" class="btn-ghost" id="backWorkout">‹ ' + (selectedDay == null ? 'My workouts' : 'Day') + '</button><span class="plan-eyebrow">Workout builder</span></div>' +
      '<div class="plan-routine-actions"><div><h2 class="plan-heading" style="margin-bottom:3px">' + esc(name) + '</h2><span class="plan-eyebrow">' + list.length + (list.length === 1 ? ' exercise' : ' exercises') + '</span></div><button class="plan-delete-button" id="deleteWorkout" type="button">Delete workout</button></div>' +
      '<label class="plan-eyebrow" for="exerciseSearch" style="display:block;margin-top:8px">Add exercises</label><input id="exerciseSearch" class="plan-field plan-exercise-search" placeholder="Filter by exercise or muscle" autocomplete="off" enterkeyhint="search"><div class="plan-search-results plan-exercise-list" id="exerciseResults"></div>' +
      '<div class="plan-top" style="margin-top:20px"><h2 class="plan-heading">In this workout</h2></div>' + exerciseRows + '</section>';
    document.getElementById('backWorkout').onclick = function () { selectedWorkout = null; render(); };
    document.getElementById('deleteWorkout').onclick = function () {
      if (!window.confirm('Delete "' + name + '" from your workout list? Your saved workout history will stay.')) return;
      delete window.WORKOUTS[name];
      var deleted = deletedNames(); if (deleted.indexOf(name) < 0) deleted.push(name); saveDeletedNames(deleted);
      saveRestoredNames(restoredNames().filter(function (oldName) { return oldName !== name; }));
      Object.keys(window.SCHEDULE).forEach(function (k) { if (window.SCHEDULE[k] === name) window.SCHEDULE[k] = null; });
      selectedWorkout = null; selectedDay = null; save(); render();
    };
    root.querySelectorAll('[data-remove]').forEach(function (b) { b.onclick = function () { list.splice(+b.dataset.remove, 1); save(); render(); }; });
    root.querySelectorAll('[data-k]').forEach(function (input) { input.onchange = function () { var e = list[+this.dataset.i]; e[this.dataset.k] = this.dataset.k === 'sets' ? Math.max(1, Math.min(20, +this.value || 3)) : this.value; save(); }; });
    var search = document.getElementById('exerciseSearch'), results = document.getElementById('exerciseResults');
    function showResults() {
      var q = search.value.toLowerCase();
      var filtered = moves.filter(function (x) { return !q || x.name.toLowerCase().includes(q) || x.cat.includes(q); });
      results.innerHTML = filtered.length ? filtered.map(function (x) { var added = list.some(function (e) { return e.name === x.name; }); return '<button class="plan-exercise-option" type="button" data-add-ex="' + esc(x.name) + '" ' + (added ? 'disabled' : '') + '><span><b>' + esc(x.name) + '</b><small>' + esc(x.cat) + '</small></span><span class="added-tag">' + (added ? 'Added' : '＋ Add') + '</span></button>'; }).join('') : '<div class="plan-empty">No matching exercises</div>';
      results.querySelectorAll('[data-add-ex]').forEach(function (b) { b.onclick = function () { var move = moves.find(function (x) { return x.name === b.dataset.addEx; }); list.push({ name: move.name, cat: move.cat, sets: 3, target: '8–12', rest: 90, note: '' }); save(); render(); }; });
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
