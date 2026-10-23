/* Weekly plan editor, workout navigation, and rest-day image settings. */
(function () {
  'use strict';

  var root = document.getElementById('planRoot');
  var days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var selectedDay = null;
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

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
  function names() { return Object.keys(window.WORKOUTS || {}); }
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
  }
  function dayRows() {
    return days.map(function (day, i) {
      var workout = window.SCHEDULE[i];
      return '<button class="plan-day-link" type="button" data-open-day="' + i + '"><span class="plan-day-name">' + day + '</span><span class="plan-day-workout">' + esc(workout || 'Rest day') + '</span><span class="plan-day-arrow" aria-hidden="true">›</span></button>';
    }).join('');
  }
  function renderWeek() {
    root.innerHTML = '<section class="plan-day-list"><div class="plan-eyebrow">My plan</div><h2 class="plan-heading">Your week</h2>' + dayRows() + '</section>' +
      '<section class="plan-card"><div class="plan-eyebrow">Rest day image</div><img class="plan-image-preview" src="' + esc(restImage()) + '" alt="Rest day image preview"><div class="plan-actions"><button class="btn-secondary" type="button" id="chooseRestImage">Choose image</button><button class="btn-ghost" type="button" id="resetRestImage">Reset</button></div><input id="restImageFile" type="file" accept="image/*" hidden></section>' +
      '<section class="plan-card"><button id="newPlan" class="btn-secondary" type="button" style="width:100%">＋ New workout</button></section>';
    root.querySelectorAll('[data-open-day]').forEach(function (b) { b.onclick = function () { selectedDay = +b.dataset.openDay; render(); }; });
    document.getElementById('newPlan').onclick = createPlan;
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
    if (!assigned && ns.length) assigned = '';
    var list = window.WORKOUTS[assigned] || [];
    root.innerHTML = '<section class="plan-editor"><div class="plan-top"><button type="button" class="btn-ghost" id="backWeek">‹ Week</button><span class="plan-eyebrow">' + day + '</span></div>' +
      '<label class="plan-eyebrow" for="dayWorkout">Workout</label><div class="plan-picker" id="planPicker"><button id="dayWorkout" class="plan-picker-trigger" type="button" aria-expanded="false" aria-controls="dayWorkoutOptions"><span class="plan-picker-value">' + esc(assigned || 'Rest day') + '</span><span class="plan-picker-chevron" aria-hidden="true">⌄</span></button><div class="plan-picker-list" id="dayWorkoutOptions" role="listbox"><button class="plan-picker-option ' + (!assigned ? 'is-selected' : '') + '" type="button" role="option" data-workout=""><span>Rest day</span><span>' + (!assigned ? '✓' : '') + '</span></button>' + ns.map(function (n) { return '<button class="plan-picker-option ' + (n === assigned ? 'is-selected' : '') + '" type="button" role="option" data-workout="' + esc(n) + '"><span>' + esc(n) + '</span><span>' + (n === assigned ? '✓' : '') + '</span></button>'; }).join('') + '</div></div>' +
      (assigned ? '<div class="plan-top"><h2 class="plan-heading">Exercises</h2><button id="newPlan" class="btn-ghost" type="button" aria-label="Create workout">＋</button></div>' +
        (list.length ? list.map(function (e, i) { return '<div class="plan-edit-row"><b style="font-size:12px;line-height:1.25">' + esc(e.name) + '</b><input class="plan-field" type="number" min="1" max="20" data-i="' + i + '" data-k="sets" value="' + (+e.sets || 3) + '" aria-label="Sets"><input class="plan-field" data-i="' + i + '" data-k="target" value="' + esc(e.target || '8–12') + '" aria-label="Rep target"><button class="btn-ghost danger" data-remove="' + i + '" aria-label="Remove ' + esc(e.name) + '">×</button></div>'; }).join('') : '<div class="plan-empty">No exercises yet.</div>') +
        '<label class="plan-eyebrow" for="exerciseSearch" style="display:block;margin-top:18px">Add exercise</label><input id="exerciseSearch" class="plan-field plan-exercise-search" placeholder="Filter exercises" autocomplete="off" enterkeyhint="search"><div class="plan-search-results plan-exercise-list" id="exerciseResults"></div>' : '<div class="plan-empty">Choose a workout above, or leave this day as rest.</div>') +
      '</section>';
    document.getElementById('backWeek').onclick = function () { selectedDay = null; render(); };
    var picker = document.getElementById('planPicker'), pickerButton = document.getElementById('dayWorkout');
    pickerButton.onclick = function () { var open = picker.classList.toggle('is-open'); pickerButton.setAttribute('aria-expanded', String(open)); };
    picker.querySelectorAll('[data-workout]').forEach(function (option) { option.onclick = function () { window.SCHEDULE[dayIndex] = option.dataset.workout || null; save(); render(); }; });
    if (!assigned) return;
    document.getElementById('newPlan').onclick = createPlan;
    root.querySelectorAll('[data-remove]').forEach(function (b) { b.onclick = function () { list.splice(+b.dataset.remove, 1); save(); render(); }; });
    root.querySelectorAll('[data-k]').forEach(function (input) { input.onchange = function () { var e = list[+this.dataset.i]; e[this.dataset.k] = this.dataset.k === 'sets' ? Math.max(1, Math.min(20, +this.value || 3)) : this.value; save(); }; });
    var search = document.getElementById('exerciseSearch'), results = document.getElementById('exerciseResults');
    function showResults() {
      var q = search.value.toLowerCase();
      results.innerHTML = moves.filter(function (x) { return !q || x.name.toLowerCase().includes(q) || x.cat.includes(q); }).map(function (x) { var added = list.some(function (e) { return e.name === x.name; }); return '<button class="plan-exercise-option" type="button" data-add-ex="' + esc(x.name) + '" ' + (added ? 'disabled' : '') + '><span><b>' + esc(x.name) + '</b><small>' + esc(x.cat) + '</small></span><span class="added-tag">' + (added ? 'Added' : '＋ Add') + '</span></button>'; }).join('');
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
    root.addEventListener('click', function (event) {
      if (!event.target.closest('#planPicker')) {
        picker.classList.remove('is-open');
        pickerButton.setAttribute('aria-expanded', 'false');
      }
      if (!event.target.closest('#exerciseSearch') && !event.target.closest('#exerciseResults')) {
        results.innerHTML = '';
        search.value = '';
      }
    });
  }
  function render() {
    if (!root) return;
    if (selectedDay == null) renderWeek();
    else renderDay();
  }
  function createPlan() {
    var n = prompt('Name your workout:');
    if (!n) return;
    n = n.trim();
    if (!n || window.WORKOUTS[n]) { alert('Choose a name that is not already used.'); return; }
    window.WORKOUTS[n] = [];
    window.SCHEDULE[selectedDay == null ? 0 : selectedDay] = n;
    save();
    if (selectedDay == null) selectedDay = 0;
    render();
  }
  window.openPlanWorkout = function (name, date) {
    if (window.startSession) window.startSession(name, date);
  };
  window.renderPlan = render;
  window.addEventListener('gym:plan-loaded', function () { window.renderPlan(); });
  window.renderPlan();
})();
