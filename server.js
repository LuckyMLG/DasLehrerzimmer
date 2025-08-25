const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const db = new sqlite3.Database('database.sqlite');

// create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    is_admin INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    image TEXT,
    description TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER,
    user_id INTEGER,
    stars INTEGER,
    comment TEXT,
    FOREIGN KEY(teacher_id) REFERENCES teachers(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  // insert default admin if not exists
  db.get('SELECT * FROM users WHERE username = ?', ['admin'], (err, row) => {
    if (!row) {
      db.run('INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)', ['admin', 'admin']);
    }
  });
});

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: false
}));

// make user available in views
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

function ensureAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

function ensureAdmin(req, res, next) {
  if (req.session.user && req.session.user.is_admin) return next();
  res.redirect('/');
}

app.get('/', (req, res) => {
  if (req.session.user) {
    res.redirect('/teachers');
  } else {
    res.redirect('/login');
  }
});

app.get('/register', (req, res) => {
  res.render('register', { title: 'Registrieren' });
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, password], err => {
    if (err) {
      return res.send('Fehler bei Registrierung');
    }
    res.redirect('/login');
  });
});

app.get('/login', (req, res) => {
  res.render('login', { title: 'Login' });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, user) => {
    if (user) {
      req.session.user = user;
      res.redirect('/teachers');
    } else {
      res.send('Login fehlgeschlagen');
    }
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/teachers', ensureAuth, (req, res) => {
  const sql = `SELECT t.*, AVG(r.stars) as avg FROM teachers t
               LEFT JOIN ratings r ON t.id = r.teacher_id
               GROUP BY t.id`;
  db.all(sql, (err, teachers) => {
    res.render('teachers', { title: 'Lehrer', teachers });
  });
});

app.get('/teachers/:id', ensureAuth, (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM teachers WHERE id = ?', [id], (err, teacher) => {
    if (!teacher) return res.send('Lehrer nicht gefunden');
    db.all('SELECT r.*, u.username FROM ratings r JOIN users u ON r.user_id = u.id WHERE teacher_id = ?', [id], (err, ratings) => {
      res.render('teacher', { title: teacher.name, teacher, ratings });
    });
  });
});

app.post('/teachers/:id/rate', ensureAuth, (req, res) => {
  const id = req.params.id;
  const { stars, comment } = req.body;
  db.run('INSERT INTO ratings (teacher_id, user_id, stars, comment) VALUES (?, ?, ?, ?)',
    [id, req.session.user.id, stars, comment], err => {
      res.redirect('/teachers/' + id);
    });
});

// Admin routes
app.get('/admin', ensureAdmin, (req, res) => {
  db.all('SELECT * FROM teachers', (err, teachers) => {
    db.all('SELECT id, username, password FROM users', (err2, users) => {
      res.render('admin', { title: 'Admin', teachers, users });
    });
  });
});

app.get('/admin/teachers/new', ensureAdmin, (req, res) => {
  res.render('teacher_form', { title: 'Neuer Lehrer', formTitle: 'Neuer Lehrer', action: '/admin/teachers', teacher: null });
});

app.post('/admin/teachers', ensureAdmin, upload.single('image'), (req, res) => {
  const { name, description } = req.body;
  const imagePath = '/uploads/' + req.file.filename;
  db.run('INSERT INTO teachers (name, image, description) VALUES (?, ?, ?)', [name, imagePath, description], err => {
    res.redirect('/admin');
  });
});

app.get('/admin/teachers/:id/edit', ensureAdmin, (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM teachers WHERE id = ?', [id], (err, teacher) => {
    if (!teacher) return res.send('Nicht gefunden');
    res.render('teacher_form', { title: 'Lehrer bearbeiten', formTitle: 'Lehrer bearbeiten', action: '/admin/teachers/' + id + '/update', teacher });
  });
});

app.post('/admin/teachers/:id/update', ensureAdmin, upload.single('image'), (req, res) => {
  const id = req.params.id;
  const { name, description } = req.body;
  if (req.file) {
    const imagePath = '/uploads/' + req.file.filename;
    db.run('UPDATE teachers SET name = ?, description = ?, image = ? WHERE id = ?', [name, description, imagePath, id], err => {
      res.redirect('/admin');
    });
  } else {
    db.run('UPDATE teachers SET name = ?, description = ? WHERE id = ?', [name, description, id], err => {
      res.redirect('/admin');
    });
  }
});

app.post('/admin/teachers/:id/delete', ensureAdmin, (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM teachers WHERE id = ?', [id], err => {
    res.redirect('/admin');
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Server läuft auf Port ' + port));
