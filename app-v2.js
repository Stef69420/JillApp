if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js'); });
}

const supabaseUrl = 'https://wzmhdxrgbcatamwlrlxj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6bWhkeHJnYmNhdGFtd2xybHhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NDg2NjUsImV4cCI6MjA5MjQyNDY2NX0.ZcoJqSBiQLyJbqkYSS4izLNQKOoZ3RsKod8Vxr8s90o';
const _sb = window.supabase.createClient(supabaseUrl, supabaseKey);

const mainContent = document.getElementById('main-content');
const navItems = document.querySelectorAll('.nav-item');
let currentView = 'home';
let currentUser = null;
let isLoginMode = true;

const td = new Date();
const formatDate = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const todayStr = formatDate(td.getFullYear(), td.getMonth(), td.getDate());

const appState = {
    isSearching: false, searchQuery: '', activeBookId: 1,
    calBaseDate: td.getTime(), calScope: 'month', selectedDateStr: todayStr,
    isTodoModalOpen: false, modalDateStr: '', modalBookIdDefault: null,
    todoRepeatOption: 'once', 
    selectedDays: [], 
    selectedDates: [], 
    todoTemplates: [],
    todoInstances: [],
    isDeleteModalOpen: false,
    pendingDeleteTodo: null,
    isApptModalOpen: false, apptDateStr: '', apptTimeStr: '',
    books: [],
    todos: [],
    appointments: []
};

// --- Auth UI Logic ---
window.toggleAuthMode = () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? 'Willkommen zurück!' : 'Neuer Account';
    document.getElementById('auth-subtitle').innerText = isLoginMode ? 'Bitte melde dich an, um dein Journal zu öffnen.' : 'Erstelle ein sicheres Journal für dich.';
    document.getElementById('auth-submit-btn').innerText = isLoginMode ? 'Anmelden' : 'Registrieren';
    document.getElementById('auth-toggle-text').innerText = isLoginMode ? 'Noch kein Account?' : 'Schon dabei?';
    document.getElementById('auth-toggle-btn').innerText = isLoginMode ? 'Hier registrieren' : 'Hier anmelden';
    document.getElementById('auth-error').style.display = 'none';
};

window.handleAuthSubmit = async () => {
    console.log("=== Auth Submit ===");
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    console.log("Mode:", isLoginMode ? "Login" : "Register", "| Email:", email);
    
    const errEl = document.getElementById('auth-error');
    errEl.style.display = 'none';

    if(!email || !password) {
        console.warn("Validation failed: Email or password empty");
        errEl.innerText = "Bitte fülle beide Felder aus.";
        errEl.style.display = 'block';
        return;
    }

    document.getElementById('auth-submit-btn').innerText = 'Lädt...';

    let error;
    try {
        if(isLoginMode) {
            console.log("Calling _sb.auth.signInWithPassword...");
            const res = await _sb.auth.signInWithPassword({ email, password });
            console.log("signIn response:", res);
            error = res.error;
        } else {
            console.log("Calling _sb.auth.signUp...");
            const res = await _sb.auth.signUp({ email, password });
            console.log("signUp response:", res);
            error = res.error;
        }
    } catch (e) {
        console.error("Exception in auth:", e);
        error = e;
    }

    if(error) {
        console.error("Auth Error Details:", error.message || error);
        errEl.innerText = "Fehler: " + (error.message || JSON.stringify(error));
        errEl.style.display = 'block';
        document.getElementById('auth-submit-btn').innerText = isLoginMode ? 'Anmelden' : 'Registrieren';
    } else {
        console.log("Auth call successful, waiting for state change...");
        document.getElementById('auth-submit-btn').innerText = 'Erfolgreich!';
    }
};

window.logout = async () => {
    await _sb.auth.signOut();
};

const loadData = async () => {
    console.log("loadData() started. Current user:", currentUser?.email);
    if(!currentUser) return;
    
    try {
        console.log("Fetching data from Supabase...");
        const [booksRes, templatesRes, instancesRes, apptsRes] = await Promise.all([
            _sb.from('books').select('*').order('id', {ascending: true}),
            _sb.from('todo_templates').select('*'),
            _sb.from('todo_instances').select('*'),
            _sb.from('appointments').select('*')
        ]);
        
        console.log("Books DB error:", booksRes.error);
        console.log("Templates DB error:", templatesRes.error);
        console.log("Instances DB error:", instancesRes.error);
        console.log("Appts DB error:", apptsRes.error);
        
        if(booksRes.data) appState.books = booksRes.data.map(b => ({
            id: b.id, title: b.title, color: b.color, textColor: b.text_color, type: b.type, isLocked: b.is_locked, notes: b.notes
        }));
        if(templatesRes.data) appState.todoTemplates = templatesRes.data;
        if(instancesRes.data) appState.todoInstances = instancesRes.data.map(t => ({
            id: t.id, template_id: t.template_id, title: t.title, bookId: t.book_id, dateStr: t.date_str, isDone: t.is_done
        }));
        
        await window.generateInstancesForToday();

        if(apptsRes.data) appState.appointments = apptsRes.data.map(a => ({
            id: a.id, title: a.title, dateStr: a.date_str, timeStr: a.time_str, color: a.color
        }));
        triggerRender();
        console.log("loadData() complete.");
    } catch(e) {
        console.error("Exception in loadData:", e);
    }
};

// Global standard helpers
window.handleSearch = (el) => { appState.searchQuery = el.value; triggerRender(); setTimeout(() => { const input = document.getElementById('book-search'); if(input) { input.focus(); input.setSelectionRange(el.selectionStart, el.selectionStart); } }, 0); };
window.goToBooks = () => { document.querySelector('[data-view="books"]').click(); };

window.changeTodoTab = (tab) => { appState.todoTab = tab; triggerRender(); };
window.updateBookNotes = async (id, text) => { const b = appState.books.find(x => x.id === id); if(b) { b.notes = text; await _sb.from('books').update({ notes: text }).eq('id', id); } };

// Book management
window.updateBookTitle = async (id, val) => { const b = appState.books.find(x => x.id === id); if(b) { b.title = val; await _sb.from('books').update({ title: val }).eq('id', id); } };
window.updateBookColor = async (id, color) => { const b = appState.books.find(x => x.id === id); if(b) { b.color = color; triggerRender(); await _sb.from('books').update({ color: color }).eq('id', id); } };
window.updateBookTextColor = async (id, color) => { const b = appState.books.find(x => x.id === id); if(b) { b.textColor = color; triggerRender(); await _sb.from('books').update({ text_color: color }).eq('id', id); } };
window.deleteBook = async (id) => { appState.books = appState.books.filter(x => x.id !== id); triggerRender(); await _sb.from('books').delete().eq('id', id); };
window.addBook = async () => { 
    const { data } = await _sb.from('books').insert([{ title: 'Neues Buch', color: '#fef08a', text_color: '#6b7280', type: 'todo', is_locked: false }]).select();
    if(data && data.length > 0) {
        const b = data[0];
        appState.books.push({ id: b.id, title: b.title, color: b.color, textColor: b.text_color, type: b.type, isLocked: b.is_locked, notes: b.notes });
        triggerRender();
    }
};
window.updateBookType = async (id, type) => { const b = appState.books.find(x => x.id === id); if(b && !b.isLocked) { b.type = type; triggerRender(); await _sb.from('books').update({ type: type }).eq('id', id); } };
window.lockBook = async (id) => { const b = appState.books.find(x => x.id === id); if(b) { b.isLocked = true; triggerRender(); await _sb.from('books').update({ is_locked: true }).eq('id', id); } };

window.openBook = (id) => {
    const b = appState.books.find(x => x.id === id);
    if (b) {
        appState.activeBookId = id;
        currentView = b.type;
        navItems.forEach(n => n.classList.remove('active'));
        triggerRender();
    }
};

// Data getters
window.getDateTodos = (dateStr, dateObj) => {
    const dayOfWeek = dateObj.getDay() || 7;
    const dateNum = dateObj.getDate();
    
    return appState.todoInstances.filter(t => t.dateStr === dateStr).map(t => {
        const b = appState.books.find(x => x.id == t.bookId);
        return { ...t, color: b ? b.color : '#e5e7eb' };
    });
};

window.getDateAppointments = (dateStr) => {
    return appState.appointments.filter(a => a.dateStr === dateStr);
};

// Calendar Navigation
window.changeCalScope = (scope) => { appState.calScope = scope; triggerRender(); };
window.calNavigate = (dir) => {
    const d = new Date(appState.calBaseDate);
    if (appState.calScope === 'month') { d.setMonth(d.getMonth() + dir); } 
    else if (appState.calScope === 'week') { d.setDate(d.getDate() + (dir * 7)); } 
    else {
        d.setDate(d.getDate() + dir);
        appState.selectedDateStr = formatDate(d.getFullYear(), d.getMonth(), d.getDate());
    }
    appState.calBaseDate = d.getTime();
    triggerRender();
};
window.calSelectDate = (yyyy, mm, dd) => {
    appState.selectedDateStr = formatDate(yyyy, mm, dd);
    appState.calBaseDate = new Date(yyyy, mm, dd).getTime();
    appState.calScope = 'day';
    triggerRender();
};

window.openTodoModal = (dateStr, defaultBookId = null) => { 
    appState.isTodoModalOpen = true; 
    appState.modalDateStr = dateStr; 
    appState.modalBookIdDefault = defaultBookId;
    appState.todoRepeatOption = 'once';
    appState.selectedDays = [];
    appState.selectedDates = [];
    triggerRender(); 
};
window.closeTodoModal = () => { appState.isTodoModalOpen = false; triggerRender(); };

window.saveTodo = async () => {
    const title = document.getElementById('modal-todo-title').value;
    const bookId = document.getElementById('modal-todo-book').value;
    const repeatOption = appState.todoRepeatOption;
    if (!title) return;

    const bookIdVal = bookId === 'sonstiges' ? null : parseInt(bookId);

    if (repeatOption === 'once') {
        const { data } = await _sb.from('todo_instances').insert([{
            title: title, book_id: bookIdVal, date_str: appState.modalDateStr, is_done: false
        }]).select();
        if (data && data.length > 0) {
            const t = data[0];
            appState.todoInstances.push({
                id: t.id, template_id: t.template_id, title: t.title, bookId: t.book_id, dateStr: t.date_str, isDone: t.is_done
            });
        }
    } else {
        const { data } = await _sb.from('todo_templates').insert([{
            title: title, book_id: bookIdVal, repeat_type: repeatOption,
            repeat_days: repeatOption === 'weekly' ? appState.selectedDays : null,
            repeat_dates: repeatOption === 'monthly' ? appState.selectedDates : null
        }]).select();
        if (data && data.length > 0) {
            appState.todoTemplates.push(data[0]);
            await window.generateInstancesForToday();
        }
    }
    window.closeTodoModal();
    triggerRender();
};

window.generateInstancesForToday = async () => {
    const now = new Date();
    const ds = formatDate(now.getFullYear(), now.getMonth(), now.getDate());
    const dow = now.getDay() || 7;
    const dom = now.getDate();

    for (const temp of appState.todoTemplates) {
        let match = false;
        if (temp.repeat_type === 'daily') match = true;
        else if (temp.repeat_type === 'weekly' && temp.repeat_days?.includes(dow)) match = true;
        else if (temp.repeat_type === 'monthly' && temp.repeat_dates?.includes(dom)) match = true;

        if (match) {
            const exists = appState.todoInstances.find(i => i.template_id === temp.id && i.dateStr === ds);
            if (!exists) {
                const { data } = await _sb.from('todo_instances').insert([{
                    template_id: temp.id, title: temp.title, book_id: temp.book_id, date_str: ds, is_done: false
                }]).select();
                if (data && data.length > 0) appState.todoInstances.push(data[0]);
            }
        }
    }
    triggerRender();
};

window.toggleTodo = async (id) => {
    const t = appState.todoInstances.find(x => x.id === id);
    if(t) {
        t.isDone = !t.isDone;
        triggerRender();
        await _sb.from('todo_instances').update({ is_done: t.isDone }).eq('id', id);
    }
};

window.deleteTodo = (id) => {
    const t = appState.todoInstances.find(x => x.id === id);
    if(t && t.template_id) {
        appState.pendingDeleteTodo = t;
        appState.isDeleteModalOpen = true;
        triggerRender();
    } else {
        window.confirmDeleteInstance(id);
    }
};

window.confirmDeleteInstance = async (id) => {
    appState.todoInstances = appState.todoInstances.filter(x => x.id !== id);
    appState.isDeleteModalOpen = false;
    triggerRender();
    await _sb.from('todo_instances').delete().eq('id', id);
};

window.confirmDeleteForever = async (templateId) => {
    appState.todoTemplates = appState.todoTemplates.filter(x => x.id !== templateId);
    appState.todoInstances = appState.todoInstances.filter(x => x.template_id !== templateId);
    appState.isDeleteModalOpen = false;
    triggerRender();
    await _sb.from('todo_templates').delete().eq('id', templateId);
};

window.closeDeleteModal = () => {
    appState.isDeleteModalOpen = false;
    appState.pendingDeleteTodo = null;
    triggerRender();
};

window.deleteTemplate = async (id) => {
    if(confirm("Möchtest du diese Regel wirklich dauerhaft löschen?")) {
        appState.todoTemplates = appState.todoTemplates.filter(x => x.id !== id);
        triggerRender();
        await _sb.from('todo_templates').delete().eq('id', id);
    }
};

window.openApptModal = (dateStr, timeStr) => { appState.isApptModalOpen = true; appState.apptDateStr = dateStr; appState.apptTimeStr = timeStr; triggerRender(); };
window.closeApptModal = () => { appState.isApptModalOpen = false; triggerRender(); };

window.saveAppt = async () => {
    const title = document.getElementById('modal-appt-title').value;
    const timeStr = document.getElementById('modal-appt-time').value;
    const color = document.getElementById('modal-appt-color').value;
    if(!title) return;
    
    const { data } = await _sb.from('appointments').insert([{
        title: title, date_str: appState.apptDateStr, time_str: timeStr, color: color
    }]).select();

    if(data && data.length > 0) {
        const a = data[0];
        appState.appointments.push({
            id: a.id, title: a.title, dateStr: a.date_str, timeStr: a.time_str, color: a.color
        });
    }
    window.closeApptModal();
};

window.deleteAppt = async (id) => {
    appState.appointments = appState.appointments.filter(x => x.id !== id);
    triggerRender();
    await _sb.from('appointments').delete().eq('id', id);
};

const svgSmallBow = `<svg width="24" height="24" viewBox="0 0 100 100" style="position:absolute; top:-10px; right:-8px; transform:rotate(-15deg);" class="pencil-bow"><path d="M50 50 C 10 -10, -10 40, 50 50 C 90 -10, 110 40, 50 50 M 50 50 C 30 80, 20 100, 20 100 M 50 50 C 70 80, 80 100, 80 100" fill="none" stroke="var(--primary-color)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const views = {
    home: () => {
        const filteredBooks = appState.books.filter(b => b.title.toLowerCase().includes(appState.searchQuery.toLowerCase()));
        
        return `
        <div class="view" id="view-home">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; margin-bottom: 16px;">
                <h3 class="section-title" style="margin:0;">Meine Bücher</h3>
                <div style="display:flex; gap:12px; align-items:center;">
                    ${appState.isSearching 
                      ? `<div style="background:white; border-radius:20px; padding:6px 12px; border:1px solid rgba(0,0,0,0.1); display:flex; align-items:center; box-shadow:var(--shadow-soft);">
                             <input type="text" id="book-search" placeholder="Suchen..." value="${appState.searchQuery}" oninput="window.handleSearch(this)" style="border:none; outline:none; background:transparent; font-family:var(--font-clean); font-size:14px; width:100px;">
                             <i data-lucide="x" style="color:var(--text-muted); width:14px; cursor:pointer;" onclick="window.toggleSearch()"></i>
                         </div>`
                      : `<i data-lucide="search" style="color:var(--text-muted); cursor:pointer;" onclick="window.toggleSearch()"></i>`
                    }
                    <i data-lucide="plus-circle" style="color:var(--primary-color); cursor:pointer; width:22px; height:22px;" onclick="window.goToBooks()"></i>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                ${filteredBooks.map(book => `
                    <div onclick="window.openBook(${book.id})" style="height: 160px; background-color: ${book.color}; border-radius: 12px; box-shadow: var(--shadow-soft); position: relative; padding: 16px; display: flex; flex-direction: column; justify-content: center; align-items: center; cursor: pointer; transition: transform 0.2s ease;">
                         <div style="position: absolute; left: 10px; top: 0; bottom: 0; border-left: 2px dashed rgba(255,255,255,0.8);"></div>
                         <h4 style="color: ${book.textColor || '#6b7280'}; font-family: var(--font-hand); font-size: 26px; font-weight: 600; text-align:center; width:100%; white-space:pre-wrap; word-wrap:break-word; max-height:100%; overflow:hidden;">${book.title}</h4>
                    </div>
                `).join('')}
                ${filteredBooks.length === 0 ? '<p style="color:var(--text-muted); grid-column:1/-1;">Keine Bücher gefunden.</p>' : ''}
            </div>
        </div>
        `;
    },
    books: () => {
        const pastelPresets = ['#fce7f3', '#e8dff5', '#d1fae5', '#fef08a', '#e0f2fe', '#ffeedd'];
        return `
        <div class="view" id="view-books" style="display:block; animation:none;">
            <h2 class="section-title">Bücher anpassen</h2>
            <div style="display:flex; flex-direction:column; gap:16px; margin-top:24px;">
                ${appState.books.map(book => `
                    <div class="widget-card" style="padding:16px; display:flex; flex-direction:column; gap:12px;">
                         <div style="display:flex; justify-content:space-between; align-items:center;">
                             <input type="text" value="${book.title}" oninput="window.updateBookTitle(${book.id}, this.value)" style="font-family:var(--font-hand); font-size:24px; font-weight:600; color:${book.textColor || '#6b7280'}; border:none; border-bottom:1px solid rgba(0,0,0,0.1); background:transparent; outline:none; width:85%;">
                             <i data-lucide="trash-2" style="color:#fca5a5; cursor:pointer;" onclick="window.deleteBook(${book.id})"></i>
                         </div>
                         
                         <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
                             <span style="font-size:12px; color:var(--text-muted); font-weight:600; width:45px;">Typ:</span>
                             <select onchange="window.updateBookType(${book.id}, this.value)" ${book.isLocked ? 'disabled' : ''} style="flex:1; border:none; border-bottom:1px solid rgba(0,0,0,0.1); background:transparent; font-family:var(--font-clean); font-size:13px; outline:none; color:var(--text-main); cursor:${book.isLocked ? 'not-allowed' : 'pointer'};">
                                 <option value="todo" ${book.type==='todo'?'selected':''}>Themen To-Do Liste</option>
                                 <option value="todo-kalender" ${book.type==='todo-kalender'?'selected':''}>To-Do Kalender</option>
                                 <option value="termin-kalender" ${book.type==='termin-kalender'?'selected':''}>Termin Kalender</option>
                                 <option value="habits" ${book.type==='habits'?'selected':''}>Statistik / Habits</option>
                             </select>
                             ${!book.isLocked ? `<button onclick="window.lockBook(${book.id})" style="border:none; background:var(--primary-color); color:white; border-radius:12px; padding:4px 8px; font-size:10px; font-weight:600; cursor:pointer; box-shadow:0 2px 4px rgba(244,114,182,0.3);">Speichern</button>` : `<i data-lucide="lock" style="width:14px; height:14px; color:var(--text-muted);"></i>`}
                         </div>

                         <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:4px;">
                             <span style="font-size:12px; color:var(--text-muted); font-weight:600; width:45px;">Buch:</span>
                             ${pastelPresets.map(color => `
                                 <button onclick="window.updateBookColor(${book.id}, '${color}')" style="width:24px; height:24px; border-radius:50%; background-color:${color}; border:${book.color === color ? '2px solid var(--primary-color)' : '1px solid rgba(0,0,0,0.1)'}; cursor:pointer;"></button>
                             `).join('')}
                         </div>
                    </div>
                `).join('')}
            </div>
            
            <button onclick="window.addBook()" style="width:100%; padding:16px; border-radius:12px; border:2px dashed var(--primary-light); background:transparent; color:var(--primary-color); font-weight:600; margin-top:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
                <i data-lucide="plus" style="width:18px;"></i> Neues Buch hinzufügen
            </button>
        </div>
        `;
    },
    
    'todo-kalender': () => {
        const baseDate = new Date(appState.calBaseDate);
        const y = baseDate.getFullYear(); const m = baseDate.getMonth();
        const monthNames = ["Jan", "Feb", "März", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
        let headerText = ""; let bodyHtml = "";
        
        let scNav = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; margin-top:12px; background:rgba(255,255,255,0.8); padding:4px; border-radius:20px; box-shadow:var(--shadow-soft);">
                 <button onclick="window.changeCalScope('day')" style="flex:1; border:none; padding:8px 0; border-radius:16px; font-weight:600; font-size:13px; background:${appState.calScope === 'day' ? 'var(--primary-color)' : 'transparent'}; color:${appState.calScope === 'day' ? 'white' : 'var(--text-muted)'}; cursor:pointer; transition:all 0.2s;">Tag</button>
                 <button onclick="window.changeCalScope('week')" style="flex:1; border:none; padding:8px 0; border-radius:16px; font-weight:600; font-size:13px; background:${appState.calScope === 'week' ? 'var(--primary-color)' : 'transparent'}; color:${appState.calScope === 'week' ? 'white' : 'var(--text-muted)'}; cursor:pointer; transition:all 0.2s;">Woche</button>
                 <button onclick="window.changeCalScope('month')" style="flex:1; border:none; padding:8px 0; border-radius:16px; font-weight:600; font-size:13px; background:${appState.calScope === 'month' ? 'var(--primary-color)' : 'transparent'}; color:${appState.calScope === 'month' ? 'white' : 'var(--text-muted)'}; cursor:pointer; transition:all 0.2s;">Monat</button>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; padding:0 12px;">
                <i data-lucide="chevron-left" style="cursor:pointer; color:var(--text-main);" onclick="window.calNavigate(-1)"></i>
                <h3 style="font-size:16px; font-weight:700; color:var(--text-main); margin:0;">\${headerText}</h3>
                <i data-lucide="chevron-right" style="cursor:pointer; color:var(--text-main);" onclick="window.calNavigate(1)"></i>
            </div>`;

        if (appState.calScope === 'month') {
            headerText = `${monthNames[m]} ${y}`;
            const daysInMonth = new Date(y, m + 1, 0).getDate();
            let startOffset = new Date(y, m, 1).getDay() || 7; startOffset -= 1;
            
            let gridHtml = `<div style="display:grid; grid-template-columns:repeat(7, 1fr); text-align:center; gap:4px; font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:8px;">
                <div>Mo</div><div>Di</div><div>Mi</div><div>Do</div><div>Fr</div><div>Sa</div><div>So</div>
            </div><div style="display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:6px; font-size:12px; flex:1;">`;
            
            for(let i=0; i<startOffset; i++) { gridHtml += `<div></div>`; }
            
            for(let d=1; d<=daysInMonth; d++) {
                const dateStr = formatDate(y, m, d);
                const dateObj = new Date(y, m, d);
                const dayTodos = window.getDateTodos(dateStr, dateObj);
                const isSelected = appState.selectedDateStr === dateStr;
                
                let evtHtml = dayTodos.slice(0, 3).map(e => `<div style="background:${e.color}; width:100%; height:4px; margin-top:2px; border-radius:2px;"></div>`).join('');
                if(dayTodos.length > 3) evtHtml += `<div style="font-size:8px; color:var(--text-muted); text-align:center;">+${dayTodos.length - 3}</div>`;
                
                gridHtml += `<div style="min-height:80px; border-radius:8px; padding:2px; display:flex; flex-direction:column; cursor:pointer; align-items:center; background:${isSelected ? 'rgba(0,0,0,0.03)' : 'transparent'}; border:${isSelected ? '1px solid var(--primary-color)' : '1px solid transparent'};" onclick="window.calSelectDate(${y}, ${m}, ${d})">
                                <span style="font-weight: ${isSelected ? 'bold' : 'normal'}; text-align:center; margin-bottom:2px; width:22px; height:22px; display:flex; justify-content:center; align-items:center; ${isSelected ? 'background:var(--primary-color); color:white; border-radius:50%;' : ''}">${d}</span>
                                <div style="display:flex; flex-direction:column; width:80%; gap:2px; margin-top:2px;">${evtHtml}</div>
                             </div>`;
            }
            gridHtml += `</div>`;
            bodyHtml = `<div class="widget-card" style="padding:16px; display:flex; flex-direction:column; margin-bottom:0;">${gridHtml}</div>`;
            
        } else if (appState.calScope === 'week') {
            headerText = `${monthNames[m]} ${y}`;
            let startOfWeek = new Date(baseDate); startOfWeek.setDate(baseDate.getDate() - (baseDate.getDay()||7) + 1); 
            
            let wHtml = `<div style="display:flex; flex-direction:column; gap:12px; margin-top:12px;">`;
            for(let i=0; i<7; i++) {
                 let d = new Date(startOfWeek); d.setDate(d.getDate() + i);
                 const dateStr = formatDate(d.getFullYear(), d.getMonth(), d.getDate());
                 const dayTodos = window.getDateTodos(dateStr, d);
                 const isSelected = appState.selectedDateStr === dateStr;
                 
                 wHtml += `<div style="background:white; border-radius:12px; padding:12px; border:${isSelected ? '1px solid var(--primary-color)' : '1px solid transparent'}; box-shadow:var(--shadow-soft); cursor:pointer;" onclick="window.calSelectDate(${d.getFullYear()}, ${d.getMonth()}, ${d.getDate()})">
                    <div style="font-weight:600; font-size:14px; margin-bottom:12px;">${['Mo','Di','Mi','Do','Fr','Sa','So'][i]}, ${d.getDate()}.</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                       ${dayTodos.map(e => `<div style="background:${e.color}; padding:6px 10px; border-radius:6px; font-size:12px; display:flex; gap:8px;">
                            <span>${e.isDone ? '✅' : '⏳'} ${e.title}</span>
                       </div>`).join('')}
                       ${dayTodos.length === 0 ? `<span style="font-size:12px; color:var(--text-muted); opacity:0.6;">Keine To-Dos</span>` : ''}
                    </div>
                 </div>`;
            }
            bodyHtml = wHtml + `</div>`;
            
        } else if (appState.calScope === 'day') {
             headerText = `${baseDate.getDate()}. ${monthNames[m]} ${y}`;
             const dateStr = formatDate(y, m, baseDate.getDate());
             const dayTodos = window.getDateTodos(dateStr, baseDate);
             
             let dHtml = `<div style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px;">`;
             if(dayTodos.length === 0) {
                  dHtml += `<div style="text-align:center; padding:40px 20px;">
                      <div style="font-size:40px; margin-bottom:16px;">🛌 🧸</div>
                      <h3 style="color:var(--text-main); font-weight:700; margin-bottom:8px;">Ausruhen angesagt!</h3>
                      <p style="color:var(--text-muted); font-size:14px; line-height:1.5;">Keine Aufgaben für heute.</p>
                  </div>`;
             } else {
                 dHtml += dayTodos.map(e => `
                    <div style="background:${e.color}; padding:18px; border-radius:16px; box-shadow:var(--shadow-soft); display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap:12px;" onclick="window.toggleTodo(${e.id})">
                            <div style="width:20px; height:20px; border-radius:6px; background:${e.isDone ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)'}; border:2px solid rgba(0,0,0,0.2); cursor:pointer;"></div>
                            <span style="font-weight:600; font-size:15px; color:#1f2937; text-decoration:${e.isDone ? 'line-through' : 'none'}; opacity:${e.isDone ? '0.5' : '1'};">${e.title}</span>
                        </div>
                        <i data-lucide="trash-2" style="width:16px; cursor:pointer; color:rgba(0,0,0,0.3);" onclick="window.deleteTodo(${e.id})"></i>
                    </div>
                 `).join('');
             }
             dHtml += `<button onclick="window.openTodoModal('${dateStr}')" style="width:100%; border:2px dashed var(--primary-light); background:transparent; color:var(--primary-color); font-weight:600; padding:16px; border-radius:16px; margin-top:8px; display:flex; justify-content:center; align-items:center; gap:8px;">
                     <i data-lucide="plus" style="width:18px;"></i> To-Do hinzufügen
                </button></div>`;
             bodyHtml = dHtml;
        }

        scNav = scNav.replace('\${headerText}', headerText);

        return `<div class="view" id="view-todocal">
            <h2 class="section-title">To-Do Plan ${svgSmallBow}</h2>
            ${scNav}
            <div style="padding-bottom:100px;">${bodyHtml}</div>
        </div>`;
    },

    'termin-kalender': () => {
        const baseDate = new Date(appState.calBaseDate);
        const y = baseDate.getFullYear(); const m = baseDate.getMonth();
        const monthNames = ["Jan", "Feb", "März", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
        let headerText = ""; let bodyHtml = "";
        
        let scNav = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; margin-top:12px; background:rgba(255,255,255,0.8); padding:4px; border-radius:20px; box-shadow:var(--shadow-soft);">
                 <button onclick="window.changeCalScope('day')" style="flex:1; border:none; padding:8px 0; border-radius:16px; font-weight:600; font-size:13px; background:${appState.calScope === 'day' ? 'var(--primary-color)' : 'transparent'}; color:${appState.calScope === 'day' ? 'white' : 'var(--text-muted)'}; cursor:pointer;">Tag</button>
                 <button onclick="window.changeCalScope('week')" style="flex:1; border:none; padding:8px 0; border-radius:16px; font-weight:600; font-size:13px; background:${appState.calScope === 'week' ? 'var(--primary-color)' : 'transparent'}; color:${appState.calScope === 'week' ? 'white' : 'var(--text-muted)'}; cursor:pointer;">Woche</button>
                 <button onclick="window.changeCalScope('month')" style="flex:1; border:none; padding:8px 0; border-radius:16px; font-weight:600; font-size:13px; background:${appState.calScope === 'month' ? 'var(--primary-color)' : 'transparent'}; color:${appState.calScope === 'month' ? 'white' : 'var(--text-muted)'}; cursor:pointer;">Monat</button>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; padding:0 12px;">
                <i data-lucide="chevron-left" style="cursor:pointer; color:var(--text-main);" onclick="window.calNavigate(-1)"></i>
                <h3 style="font-size:16px; font-weight:700; color:var(--text-main); margin:0;">\${headerText}</h3>
                <i data-lucide="chevron-right" style="cursor:pointer; color:var(--text-main);" onclick="window.calNavigate(1)"></i>
            </div>`;

        if (appState.calScope === 'month') {
            headerText = `${monthNames[m]} ${y}`;
            const daysInMonth = new Date(y, m + 1, 0).getDate();
            let startOffset = new Date(y, m, 1).getDay() || 7; startOffset -= 1;
            
            let gridHtml = `<div style="display:grid; grid-template-columns:repeat(7, 1fr); text-align:center; gap:4px; font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:8px;">
                <div>Mo</div><div>Di</div><div>Mi</div><div>Do</div><div>Fr</div><div>Sa</div><div>So</div>
            </div><div style="display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:6px; font-size:12px; flex:1;">`;
            for(let i=0; i<startOffset; i++) { gridHtml += `<div></div>`; }
            for(let d=1; d<=daysInMonth; d++) {
                const dateStr = formatDate(y, m, d);
                const dayAppts = window.getDateAppointments(dateStr);
                const isSelected = appState.selectedDateStr === dateStr;
                let evtHtml = dayAppts.slice(0, 3).map(e => `<div style="background:${e.color}; width:100%; height:4px; margin-top:2px; border-radius:2px;"></div>`).join('');
                if(dayAppts.length > 3) evtHtml += `<div style="font-size:8px; color:var(--text-muted); text-align:center;">+${dayAppts.length - 3}</div>`;
                gridHtml += `<div style="min-height:80px; border-radius:8px; padding:2px; display:flex; flex-direction:column; cursor:pointer; align-items:center; background:${isSelected ? 'rgba(0,0,0,0.03)' : 'transparent'}; border:${isSelected ? '1px solid var(--primary-color)' : '1px solid transparent'};" onclick="window.calSelectDate(${y}, ${m}, ${d})">
                                <span style="font-weight: ${isSelected ? 'bold' : 'normal'}; text-align:center; width:22px; height:22px; display:flex; justify-content:center; align-items:center; ${isSelected ? 'background:var(--primary-color); color:white; border-radius:50%;' : ''}">${d}</span>
                                <div style="display:flex; flex-direction:column; width:80%; gap:2px; margin-top:2px;">${evtHtml}</div>
                             </div>`;
            }
            gridHtml += `</div>`;
            bodyHtml = `<div class="widget-card" style="padding:16px; display:flex; flex-direction:column;">${gridHtml}</div>`;
            
        } else if (appState.calScope === 'week') {
            headerText = `${monthNames[m]} ${y}`;
            let startOfWeek = new Date(baseDate); startOfWeek.setDate(baseDate.getDate() - (baseDate.getDay()||7) + 1); 
            
            let wHtml = `<div style="display:flex; flex-direction:column; gap:12px; margin-top:12px;">`;
            for(let i=0; i<7; i++) {
                 let d = new Date(startOfWeek); d.setDate(d.getDate() + i);
                 const dateStr = formatDate(d.getFullYear(), d.getMonth(), d.getDate());
                 const dayAppts = window.getDateAppointments(dateStr);
                 const isSelected = appState.selectedDateStr === dateStr;
                 
                 wHtml += `<div style="background:white; border-radius:12px; padding:12px; border:${isSelected ? '1px solid var(--primary-color)' : '1px solid transparent'}; box-shadow:var(--shadow-soft); cursor:pointer;" onclick="window.calSelectDate(${d.getFullYear()}, ${d.getMonth()}, ${d.getDate()})">
                    <div style="font-weight:600; font-size:14px; margin-bottom:12px;">${['Mo','Di','Mi','Do','Fr','Sa','So'][i]}, ${d.getDate()}.</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                       ${dayAppts.map(e => `<div style="background:${e.color}; padding:6px 10px; border-radius:6px; font-size:12px; display:flex; gap:8px;"><span style="font-weight:700; opacity:0.6;">${e.timeStr}</span> <span style="font-weight:600;">${e.title}</span></div>`).join('')}
                       ${dayAppts.length === 0 ? `<span style="font-size:12px; color:var(--text-muted); opacity:0.6;">Keine Termine</span>` : ''}
                    </div>
                 </div>`;
            }
            bodyHtml = wHtml + `</div>`;
            
        } else if (appState.calScope === 'day') {
             headerText = `${baseDate.getDate()}. ${monthNames[m]} ${y}`;
             const dateStr = formatDate(y, m, baseDate.getDate());
             let dayAppts = window.getDateAppointments(dateStr);
             
             let dHtml = `<div style="background:rgba(255,255,255,0.7); border-radius:16px; padding:16px; box-shadow:0 8px 30px rgba(0,0,0,0.02); display:flex; flex-direction:column;">`;
             for(let h=5; h<=21; h++) {
                 const tStr = `${h.toString().padStart(2, '0')}:00`;
                 const evtsNow = dayAppts.filter(e => { const eh = parseInt(e.timeStr.split(':')[0]); return eh === h; });
                 
                 dHtml += `<div style="display:flex; gap:16px; position:relative; padding-bottom:8px;">
                     <div style="width:40px; font-size:12px; color:var(--text-muted); font-weight:600; padding-top:16px; text-align:right;">${tStr}</div>
                     <div style="width:1px; background:rgba(0,0,0,0.08); position:absolute; left:60px; top:24px; bottom:0; z-index:0;"></div>
                     ${evtsNow.length > 0 ? `<div style="width:10px; height:10px; border-radius:50%; background:var(--primary-color); border:2px solid #fff; position:absolute; left:55px; top:18px; z-index:1;"></div>` : `<div style="width:6px; height:6px; border-radius:50%; background:#e5e7eb; position:absolute; left:57px; top:20px; z-index:1;"></div>`}
                     <div style="flex:1; padding-left:8px; padding-bottom:12px; display:flex; flex-direction:column; gap:8px; z-index:2;">
                        ${evtsNow.map(e => `<div style="background:${e.color}; margin-top:8px; padding:12px 14px; border-radius:12px; font-size:13px; color:#1f2937; box-shadow:0 2px 8px rgba(0,0,0,0.04); display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-weight:500;">${e.title}</span><i data-lucide="x" style="width:14px; cursor:pointer;" onclick="window.deleteAppt(${e.id})"></i>
                            </div>`).join('')}
                        ${evtsNow.length === 0 ? `<div style="height:32px; margin-top:8px; border-radius:12px; border:1px dashed rgba(0,0,0,0.1); display:flex; align-items:center; padding:0 12px; cursor:pointer;" onclick="window.openApptModal('${dateStr}', '${tStr}')"><span style="font-size:11px; color:var(--text-muted); font-weight:600;">+ Termin eintragen</span></div>` : ''}
                     </div>
                 </div>`;
             }
             dHtml += `</div>`;
             bodyHtml = dHtml;
        }

        scNav = scNav.replace('\${headerText}', headerText);

        return `<div class="view" id="view-terminkal">
            <h2 class="section-title">Termine ${svgSmallBow}</h2>
            ${scNav}
            <div style="padding-bottom:100px;">${bodyHtml}</div>
        </div>`;
    },

    todo: () => {
        const b = appState.books.find(x => x.id === appState.activeBookId) || { title: 'To-Do Liste', type: 'todo', notes: '' };
        appState.todoTab = appState.todoTab || 'daily';
        
        const bTemplates = appState.todoTemplates.filter(t => t.book_id === b.id);
        const bInstances = appState.todoInstances.filter(t => t.bookId === b.id);
        
        let visibleItems = [];
        if(appState.todoTab === 'daily') {
            // Zeige heutige Instanzen
            visibleItems = bInstances.filter(i => i.dateStr === todayStr);
        }
        else if(appState.todoTab === 'weekly') {
            visibleItems = bTemplates.filter(t => t.repeat_type === 'weekly');
        }
        else if(appState.todoTab === 'monthly') {
            visibleItems = bTemplates.filter(t => t.repeat_type === 'monthly');
        }
        
        const renderItem = (t) => {
            const isTemplate = !!t.repeat_type;
            const isDone = !isTemplate && t.isDone;
            return `
             <div class="widget-card" style="display:flex; align-items:center; justify-content:space-between; padding:16px; margin-bottom:12px;" ${!isTemplate ? `onclick="window.toggleTodo(${t.id})"` : ''}>
                <div style="display:flex; align-items:center; gap:12px;">
                    ${isTemplate 
                        ? `<i data-lucide="repeat" style="width:18px; color:var(--primary-color);"></i>` 
                        : `<div style="width:20px; height:20px; border-radius:6px; background:${isDone ? 'rgba(0,0,0,0.5)' : 'transparent'}; border:2px solid ${b.color}; cursor:pointer;"></div>`
                    }
                    <div style="display:flex; flex-direction:column;">
                        <span style="font-weight:500; font-size:15px; text-decoration:${isDone ? 'line-through' : 'none'}; ${isDone ? 'opacity:0.5' : ''}">${t.title}</span>
                        ${isTemplate ? `<span style="font-size:10px; color:var(--text-muted);">${t.repeat_type === 'weekly' ? 'Wöchentlich' : 'Monatlich'}</span>` : ''}
                    </div>
                </div>
                <i data-lucide="trash-2" style="width:16px; cursor:pointer; color:rgba(0,0,0,0.3);" onclick="event.stopPropagation(); ${isTemplate ? `window.deleteTemplate(${t.id})` : `window.deleteTodo(${t.id})`}"></i>
             </div>
            `;
        };

        return `
        <div class="view" id="view-todo">
            <h2 class="section-title">${b.title} <span style="font-size:12px; padding:4px 8px; border-radius:12px; background:${b.color}; color:#fff; font-family:var(--font-clean);">Checklist</span></h2>
            
            <div style="display:flex; justify-content:center; gap:8px; margin-bottom:24px; background:#fff; padding:6px; border-radius:30px; box-shadow:var(--shadow-soft);">
                 <button onclick="window.changeTodoTab('daily')" style="flex:1; padding:8px 16px; border-radius:24px; border:none; transition:all 0.2s; background:${appState.todoTab === 'daily' ? 'var(--primary-color)' : 'transparent'}; color:${appState.todoTab === 'daily' ? 'white' : 'var(--text-muted)'}; font-weight:600; font-size:13px; cursor:pointer;">Tages-Liste</button>
                 <button onclick="window.changeTodoTab('weekly')" style="flex:1; padding:8px 16px; border-radius:24px; border:none; transition:all 0.2s; background:${appState.todoTab === 'weekly' ? 'var(--primary-color)' : 'transparent'}; color:${appState.todoTab === 'weekly' ? 'white' : 'var(--text-muted)'}; font-weight:600; font-size:13px; cursor:pointer;">Woche</button>
                 <button onclick="window.changeTodoTab('monthly')" style="flex:1; padding:8px 16px; border-radius:24px; border:none; transition:all 0.2s; background:${appState.todoTab === 'monthly' ? 'var(--primary-color)' : 'transparent'}; color:${appState.todoTab === 'monthly' ? 'white' : 'var(--text-muted)'}; font-weight:600; font-size:13px; cursor:pointer;">Monat</button>
            </div>
            
            <div style="min-height:50px;">
                ${visibleItems.map(t => renderItem(t)).join('')}
                ${visibleItems.length === 0 ? `<p style="text-align:center; color:var(--text-muted); margin-top:20px;">Keine Einträge in dieser Liste.</p>` : ''}
            </div>

            <button onclick="window.openTodoModal('${todayStr}', ${b.id})" style="width:100%; border:2px dashed var(--primary-light); background:transparent; color:var(--primary-color); font-weight:600; padding:16px; border-radius:16px; margin-top:8px; margin-bottom:32px; display:flex; justify-content:center; align-items:center; gap:8px; cursor:pointer;">
                <i data-lucide="plus" style="width:18px;"></i> ${b.title} To-Do hinzufügen
            </button>

            <div style="margin-top:24px;">
                <h3 style="font-size:13px; font-weight:700; color:var(--text-muted); margin-bottom:12px; letter-spacing:0.5px;">NOTIZEN</h3>
                <textarea oninput="window.updateBookNotes(${b.id}, this.value)" style="width:100%; border:none; background:rgba(255,255,255,0.8); border-radius:12px; padding:16px; font-size:14px; color:var(--text-main); height:150px; resize:none; outline:none; box-shadow:var(--shadow-soft);" placeholder="Tap to add notes...">${b.notes || ''}</textarea>
            </div>
        </div>
        `;
    },
    habits: () => {
        return `<div class="view"><h2 class="section-title">Statistik</h2><p style="color:var(--text-muted); padding:20px;">Die Statistik-Aktivitäten werden hier später visualisiert.</p></div>`;
    }
};

function triggerRender() {
    mainContent.innerHTML = views[currentView]();
    
    if(appState.isTodoModalOpen) {
        document.body.insertAdjacentHTML('beforeend', `
        <div id="todo-modal" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.4); z-index:100; display:flex; justify-content:center; align-items:center; backdrop-filter:blur(4px);">
             <div style="background:white; border-radius:24px; padding:24px; width:90%; max-width:350px; box-shadow:0 20px 40px rgba(0,0,0,0.2);">
                 <h3 style="font-family:var(--font-hand); font-size:24px; margin-bottom:16px;">Neues To-Do</h3>
                 <input type="text" id="modal-todo-title" placeholder="Was ist zu tun?" style="width:100%; padding:12px; border-radius:12px; border:1px solid #e5e7eb; margin-bottom:16px; font-family:var(--font-clean); outline:none;">
                 
                 <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:8px;">KATEGORIE / THEMA</div>
                 <select id="modal-todo-book" style="width:100%; padding:12px; border-radius:12px; border:1px solid #e5e7eb; margin-bottom:16px; font-family:var(--font-clean); outline:none; background:#fff;">
                     <option value="sonstiges">🎨 Sonstiges</option>
                     ${appState.books.filter(b => b.type === 'todo').map(b => `<option value="${b.id}" ${b.id === appState.modalBookIdDefault ? 'selected' : ''}>📚 ${b.title}</option>`).join('')}
                 </select>

                  <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:8px;">WIEDERHOLUNG</div>
                  <select id="modal-todo-repeat" onchange="window.onTodoRepeatChange(this.value)" style="width:100%; padding:12px; border-radius:12px; border:1px solid #e5e7eb; margin-bottom:12px; font-family:var(--font-clean); outline:none; background:#fff;">
                      <option value="once" ${appState.todoRepeatOption === 'once' ? 'selected' : ''}>Einmalig (Datum: ${appState.modalDateStr})</option>
                      <option value="daily" ${appState.todoRepeatOption === 'daily' ? 'selected' : ''}>Täglich</option>
                      <option value="weekly" ${appState.todoRepeatOption === 'weekly' ? 'selected' : ''}>Wöchentlich</option>
                      <option value="monthly" ${appState.todoRepeatOption === 'monthly' ? 'selected' : ''}>Monatlich</option>
                  </select>

                  ${appState.todoRepeatOption === 'weekly' ? `
                      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px;">
                          ${['Mo','Di','Mi','Do','Fr','Sa','So'].map((day, idx) => {
                              const dNum = idx + 1;
                              const sel = appState.selectedDays.includes(dNum);
                              return `<button onclick="window.toggleModalDay(${dNum})" style="width:36px; height:36px; border-radius:50%; border:1px solid ${sel ? 'var(--primary-color)' : '#e5e7eb'}; background:${sel ? 'var(--primary-color)' : 'white'}; color:${sel ? 'white' : 'var(--text-muted)'}; font-size:11px; font-weight:600; cursor:pointer;">${day}</button>`;
                          }).join('')}
                      </div>
                  ` : ''}

                  ${appState.todoRepeatOption === 'monthly' ? `
                      <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:4px; margin-bottom:16px;">
                          ${Array.from({length: 31}, (_, i) => i + 1).map(d => {
                              const sel = appState.selectedDates.includes(d);
                              return `<button onclick="window.toggleModalDate(${d})" style="width:100%; height:30px; border-radius:6px; border:1px solid ${sel ? 'var(--primary-color)' : '#e5e7eb'}; background:${sel ? 'var(--primary-color)' : 'white'}; color:${sel ? 'white' : 'var(--text-muted)'}; font-size:10px; cursor:pointer;">${d}</button>`;
                          }).join('')}
                      </div>
                  ` : ''}
                  
                  <div style="display:flex; gap:12px;">
                      <button onclick="window.closeTodoModal()" style="flex:1; padding:12px; border-radius:12px; border:1px solid #e5e7eb; background:transparent; font-weight:600; cursor:pointer;">Abbrechen</button>
                      <button onclick="window.saveTodo()" style="flex:1; padding:12px; border-radius:12px; border:none; background:var(--primary-color); color:white; font-weight:600; cursor:pointer;">Speichern</button>
                  </div>
              </div>
         </div>`);
    }

    if(appState.isDeleteModalOpen && appState.pendingDeleteTodo) {
        document.body.insertAdjacentHTML('beforeend', `
        <div id="delete-modal" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.4); z-index:110; display:flex; justify-content:center; align-items:center; backdrop-filter:blur(4px);">
             <div style="background:white; border-radius:24px; padding:24px; width:90%; max-width:350px; box-shadow:0 20px 40px rgba(0,0,0,0.2); text-align:center;">
                 <div style="font-size:40px; margin-bottom:16px;">🗑️</div>
                 <h3 style="font-family:var(--font-hand); font-size:22px; margin-bottom:12px;">Aufgabe löschen</h3>
                 <p style="font-size:14px; color:var(--text-muted); margin-bottom:24px;">Möchtest du diese Aufgabe nur für heute oder dauerhaft für immer löschen?</p>
                 
                 <div style="display:flex; flex-direction:column; gap:12px;">
                     <button onclick="window.confirmDeleteInstance(${appState.pendingDeleteTodo.id})" style="padding:12px; border-radius:12px; border:none; background:var(--primary-color); color:white; font-weight:600; cursor:pointer;">Nur für heute löschen</button>
                     <button onclick="window.confirmDeleteForever(${appState.pendingDeleteTodo.template_id})" style="padding:12px; border-radius:12px; border:1px solid #fca5a5; background:transparent; color:#f87171; font-weight:600; cursor:pointer;">Dauerhaft löschen (für immer)</button>
                     <button onclick="window.closeDeleteModal()" style="padding:12px; border-radius:12px; border:none; background:transparent; color:var(--text-muted); font-size:13px; cursor:pointer;">Abbrechen</button>
                 </div>
             </div>
        </div>`);
    }

    window.onTodoRepeatChange = (val) => { appState.todoRepeatOption = val; triggerRender(); };
    window.toggleModalDay = (d) => {
        if(appState.selectedDays.includes(d)) appState.selectedDays = appState.selectedDays.filter(x => x !== d);
        else appState.selectedDays.push(d);
        triggerRender();
    };
    window.toggleModalDate = (d) => {
        if(appState.selectedDates.includes(d)) appState.selectedDates = appState.selectedDates.filter(x => x !== d);
        else appState.selectedDates.push(d);
        triggerRender();
    };

    if(appState.isApptModalOpen) {
        document.body.insertAdjacentHTML('beforeend', `
        <div id="appt-modal" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.4); z-index:100; display:flex; justify-content:center; align-items:center; backdrop-filter:blur(4px);">
             <div style="background:white; border-radius:24px; padding:24px; width:90%; max-width:350px; box-shadow:0 20px 40px rgba(0,0,0,0.2);">
                 <h3 style="font-family:var(--font-hand); font-size:24px; margin-bottom:16px;">Neuer Termin</h3>
                 <input type="text" id="modal-appt-title" placeholder="Event Titel" style="width:100%; padding:12px; border-radius:12px; border:1px solid #e5e7eb; margin-bottom:16px; font-family:var(--font-clean); outline:none;">
                 
                 <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:8px;">UHRZEIT</div>
                 <input type="time" id="modal-appt-time" value="${appState.apptTimeStr}" style="width:100%; padding:12px; border-radius:12px; border:1px solid #e5e7eb; margin-bottom:24px; font-family:var(--font-clean); outline:none; background:#fff;">

                 <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:8px;">FARBE</div>
                 <select id="modal-appt-color" style="width:100%; padding:12px; border-radius:12px; border:1px solid #e5e7eb; margin-bottom:24px; font-family:var(--font-clean); outline:none; background:#fff;">
                     <option value="#fbcfe8">Zartrosa</option>
                     <option value="#bae6fd">Hellblau</option>
                     <option value="#bbf7d0">Mintgrün</option>
                     <option value="#fef08a">Pastellgelb</option>
                     <option value="#e9d5ff">Lila</option>
                     <option value="#ffeedd">Pfirsich</option>
                 </select>

                 <div style="display:flex; gap:12px;">
                     <button onclick="window.closeApptModal()" style="flex:1; padding:12px; border-radius:12px; border:1px solid #e5e7eb; background:transparent; font-weight:600; cursor:pointer;">Abbrechen</button>
                     <button onclick="window.saveAppt()" style="flex:1; padding:12px; border-radius:12px; border:none; background:#93c5fd; color:white; font-weight:600; cursor:pointer;">Speichern</button>
                 </div>
             </div>
        </div>`);
    }

    const viewEl = mainContent.querySelector('.view');
    if(viewEl) viewEl.classList.add('active');
    lucide.createIcons();
}

// Ensure modals get cleared correctly on re-renders
const clearModals = () => {
    const tm = document.getElementById('todo-modal'); if(tm) tm.remove();
    const am = document.getElementById('appt-modal'); if(am) am.remove();
    const dm = document.getElementById('delete-modal'); if(dm) dm.remove();
};
const originalRender = triggerRender;
triggerRender = () => {
    clearModals();
    originalRender();
};

// Check auth state on load
console.log("Initial auth check (getSession)...");
_sb.auth.getSession().then(({ data: { session }, error }) => {
    console.log("Initial session:", session ? session.user.email : "None", "| Error:", error);
    currentUser = session?.user || null;
    const overlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-container');
    if(currentUser) { 
        overlay.style.display = 'none'; 
        appContainer.style.display = 'block';
        loadData(); 
    }
    else { 
        overlay.style.display = 'flex'; 
        appContainer.style.display = 'none';
    }
}).catch(err => console.error("Initial getSession error:", err));

console.log("Setting up onAuthStateChange listener...");
_sb.auth.onAuthStateChange((event, session) => {
    console.log("--- onAuthStateChange triggered ---");
    console.log("Event:", event);
    console.log("Session User:", session?.user?.email || "None");
    
    currentUser = session?.user || null;
    const overlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-container');
    if(currentUser) { 
        console.log("User active -> Hiding login overlay, calling loadData");
        overlay.style.display = 'none'; 
        appContainer.style.display = 'block';
        loadData(); 
    } else { 
        console.log("No user -> Showing login overlay");
        overlay.style.display = 'flex'; 
        appContainer.style.display = 'none';
        appState.books = []; appState.todos = []; appState.appointments = [];
        triggerRender();
    }
});

navItems.forEach(item => {
    item.addEventListener('click', () => {
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        currentView = item.getAttribute('data-view');
        if(currentView === 'todo-kalender' || currentView === 'termin-kalender') {
             appState.selectedDateStr = todayStr;
             appState.calBaseDate = td.getTime();
             appState.calScope = 'month';
        }
        triggerRender();
    });
});
