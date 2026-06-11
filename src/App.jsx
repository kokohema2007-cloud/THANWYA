import { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Copy,
  Eye,
  FileText,
  FolderOpen,
  GraduationCap,
  KeyRound,
  LibraryBig,
  LockKeyhole,
  LogIn,
  LogOut,
  Moon,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
  User,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import {
  LEVELS,
  TYPE_LABELS,
  audienceLabel,
  defaultMajorFor,
  defaultTrackFor,
  levelById,
  majorById,
  trackById,
} from './data.js';
import { createEmptyQuestion, gradeAnswers, normalizeQuestions } from './examTools.js';
import {
  appendChildFolder,
  countNestedFolders,
  countNestedVideos,
  findFolderById,
  folderResourceSummary,
  moveFolderWithinParent,
  normalizeFolderList,
  removeFolderById,
  updateFolderById,
} from './libraryFolders.js';
import { filterLibraryForProfile } from './studentLibrary.js';
import { KEYS, bootstrapStore, hydrateStoreFromRemote, loadStore, saveStore } from './storage.js';
import { deleteVideoAsset, loadVideoAsset, saveVideoAsset } from './videoAssets.js';
import {
  clearAuthToken,
  bootstrapAdmin,
  claimLessonCode,
  fetchAuthConfig,
  fetchStudentAccess,
  loginWithCode as apiLoginWithCode,
  refreshAuthSession,
  requestVideoAccess,
} from './serverApi.js';
import { clearStoredSession, getStoredSession, setStoredSession } from './authSession.js';

function usePersistentState(key, fallback) {
  const [value, setValue] = useState(() => loadStore(key, fallback));

  useEffect(() => {
    saveStore(key, value);
  }, [key, value]);

  return [value, setValue];
}

function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function createLessonAccessCode() {
  return `LSN-${randomToken(6)}-${randomToken(4)}`;
}

function createLessonCodeEntry({ lesson, subject, teacher }) {
  if (!lesson || !subject || !teacher) return null;
  return {
    id: createId('lesson-code'),
    value: createLessonAccessCode(),
    lessonId: lesson.id,
    folderId: lesson.id,
    subjectId: subject.id,
    subjectName: subject.name,
    teacherId: teacher.id,
    teacherName: teacher.name,
    lessonTitle: lesson.title,
    status: 'unused',
    createdAt: new Date().toISOString(),
    claimedAt: '',
    claimedByStudentCodeId: '',
  };
}

function createStudentAccessCode(existingCodes) {
  const startFrom = 41510000;
  const numericCodes = existingCodes
    .map((item) => String(item.value ?? '').trim())
    .filter((value) => /^\d+$/.test(value))
    .map((value) => Number(value));

  let nextCode = Math.max(startFrom, ...numericCodes) + 1;
  const used = new Set(existingCodes.map((item) => String(item.value ?? '').trim()));
  while (used.has(String(nextCode))) {
    nextCode += 1;
  }

  return String(nextCode);
}

function randomToken(size = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buffer = new Uint32Array(size);
  window.crypto.getRandomValues(buffer);
  return Array.from(buffer, (item) => alphabet[item % alphabet.length]).join('');
}

function formatDate(value) {
  if (!value) return 'لم يستخدم';
  return new Intl.DateTimeFormat('ar-EG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDateOnly(value) {
  if (!value) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-EG', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

function studentPathLabel(profile) {
  if (!profile) return '';
  const track = trackById(profile.level, profile.track || 'general');
  const major = profile.major ? majorById(profile.level, profile.track, profile.major) : null;
  return [track?.id !== 'general' ? track?.name : '', major?.name ?? ''].filter(Boolean).join(' / ') || 'عام';
}

function TypeIcon({ type, size = 18 }) {
  if (type === 'video') return <Video size={size} aria-hidden="true" />;
  if (type === 'pdf') return <FileText size={size} aria-hidden="true" />;
  return <ClipboardList size={size} aria-hidden="true" />;
}

function StatusPill({ status }) {
  const labels = {
    unused: 'جاهز',
    active: 'مفعل',
    disabled: 'موقوف',
    published: 'منشور',
    draft: 'مسودة',
    open: 'مفتوح',
    closed: 'مغلق',
  };

  return <span className={`pill pill-${status}`}>{labels[status] ?? status}</span>;
}

function audienceFromForm(form) {
  return {
    level: form.level,
    track: form.track,
    major: form.major || '',
  };
}

function formatBackupTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function createAdminBackupPayload({ codes, lessonCodes, content, exams, library }) {
  return {
    exportedAt: new Date().toISOString(),
    app: 'THANWYA',
    data: {
      codes,
      lessonCodes,
      content,
      exams,
      library,
    },
  };
}

function downloadBackupFile(payload, prefix = 'thanwya-backup') {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${prefix}-${formatBackupTimestamp()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function App() {
  const [theme, setTheme] = useState(() => loadStore(KEYS.theme, 'light'));
  const [codes, setCodes] = usePersistentState(KEYS.codes, []);
  const [lessonCodes, setLessonCodes] = usePersistentState(KEYS.lessonCodes, []);
  const [content, setContent] = usePersistentState(KEYS.content, []);
  const [exams, setExams] = usePersistentState(KEYS.exams, []);
  const [library, setLibrary] = usePersistentState(KEYS.library, []);
  const [session, setSession] = useState(null);
  const [authConfig, setAuthConfig] = useState({ adminConfigured: true, bootstrapEnabled: false });
  const [publicScreen, setPublicScreen] = useState('landing');
  const [studentView, setStudentView] = useState('library');
  const [studentHomeSignal, setStudentHomeSignal] = useState(0);
  const [showStudentSessionBadge, setShowStudentSessionBadge] = useState(true);
  const [lastBackupAt, setLastBackupAt] = useState('');
  const adminSnapshotRef = useRef('');

  useEffect(() => {
    bootstrapStore();
    fetchAuthConfig()
      .then((config) => setAuthConfig({
        adminConfigured: Boolean(config?.adminConfigured),
        bootstrapEnabled: Boolean(config?.bootstrapEnabled),
      }))
      .catch((error) => {
        console.warn('Failed to load auth config', error);
      });

    const storedSession = getStoredSession();
    if (storedSession?.token) {
      refreshAuthSession()
        .then((current) => {
          if (!current?.token) return;
          setStoredSession(current);
          setSession(current.role === 'student'
            ? {
                role: 'student',
                token: current.token,
                profile: current.profile,
                access: current.access ?? [],
              }
            : { role: 'admin', token: current.token });
          if (current.role === 'admin') {
            hydrateStoreFromRemote().then(() => {
              setTheme(loadStore(KEYS.theme, 'light'));
              setCodes(loadStore(KEYS.codes, []));
              setLessonCodes(loadStore(KEYS.lessonCodes, []));
              setContent(loadStore(KEYS.content, []));
              setExams(loadStore(KEYS.exams, []));
              setLibrary(loadStore(KEYS.library, []));
            });
          }
          if (current.role === 'student') {
            setPublicScreen('student');
            setStudentView('profile');
          }
        })
        .catch(() => {
          clearStoredSession();
        });
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveStore(KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    if (session?.role !== 'admin') {
      adminSnapshotRef.current = '';
      return;
    }

    const snapshot = JSON.stringify({ codes, lessonCodes, content, exams, library });
    if (!adminSnapshotRef.current) {
      adminSnapshotRef.current = snapshot;
      return;
    }

    if (adminSnapshotRef.current === snapshot) return;

    adminSnapshotRef.current = snapshot;
    downloadBackupFile(createAdminBackupPayload({ codes, content, exams, library, lessonCodes }), 'thanwya-autosave');
    setLastBackupAt(new Date().toISOString());
  }, [session?.role, codes, lessonCodes, content, exams, library]);

  function exportAdminBackup() {
    downloadBackupFile(createAdminBackupPayload({ codes, content, exams, library, lessonCodes }), 'thanwya-admin-backup');
    setLastBackupAt(new Date().toISOString());
  }

  async function loginWithCode(codeValue) {
    try {
      const result = await apiLoginWithCode(codeValue);

      if (result.role === 'admin') {
        setStoredSession({ role: 'admin', token: result.token });
        await hydrateStoreFromRemote();
        setCodes(loadStore(KEYS.codes, []));
        setLessonCodes(loadStore(KEYS.lessonCodes, []));
        setContent(loadStore(KEYS.content, []));
        setExams(loadStore(KEYS.exams, []));
        setLibrary(loadStore(KEYS.library, []));
        setSession({ role: 'admin', token: result.token });
        setPublicScreen('landing');
        return '';
      }

      if (result.role === 'student') {
        setStoredSession({
          role: 'student',
          token: result.token,
          profile: {
            ...result.profile,
            access: result.access ?? [],
          },
          access: result.access ?? [],
        });
        setSession({
          role: 'student',
          token: result.token,
          profile: {
            ...result.profile,
            access: result.access ?? [],
          },
          access: result.access ?? [],
        });
        setPublicScreen('student');
        setStudentView('profile');
        setShowStudentSessionBadge(true);
        return '';
      }

      return 'تعذر تسجيل الدخول.';
    } catch (error) {
      return error instanceof Error ? error.message : 'الكود غير صحيح أو موقوف من الإدارة';
    }
  }

  async function bootstrapAdminAccount({ bootstrapToken, adminCode }) {
    try {
      await bootstrapAdmin({ bootstrapToken, adminCode });
      const config = await fetchAuthConfig();
      setAuthConfig({
        adminConfigured: Boolean(config?.adminConfigured),
        bootstrapEnabled: Boolean(config?.bootstrapEnabled),
      });
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'تعذر تهيئة الإدارة';
    }
  }

  function logoutSession() {
    const wasStudent = session?.role === 'student';
    clearAuthToken();
    clearStoredSession();
    setSession(null);
    setShowStudentSessionBadge(true);
    if (wasStudent) {
      setPublicScreen('student');
      setStudentView('profile');
      return;
    }
    setPublicScreen('landing');
  }

  function openStudentPortal() {
    if (session?.role === 'admin') return;
    if (session?.role === 'student') {
      setStudentView('profile');
      setShowStudentSessionBadge(true);
      return;
    }
    setPublicScreen('student');
  }

  return (
    <div className="app">
      <TopBar
        theme={theme}
        session={session}
        showSessionBadge={session?.role !== 'student' || showStudentSessionBadge}
        studentPortalActive={(session?.role === 'student' && studentView === 'profile') || (!session && publicScreen === 'student')}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onLogout={logoutSession}
        onOpenStudentPortal={openStudentPortal}
        onHome={() => {
          if (session?.role === 'student') {
            setStudentView('library');
            setStudentHomeSignal((current) => current + 1);
          }
        }}
      />

      {!session ? (
        publicScreen === 'student'
          ? <StudentPortalScreen onLogin={loginWithCode} />
          : <AuthScreen
              onLogin={loginWithCode}
              onOpenStudentPortal={() => setPublicScreen('student')}
              adminConfigured={authConfig.adminConfigured}
              onBootstrap={bootstrapAdminAccount}
            />
      ) : session.role === 'admin' ? (
        <AdminDashboard
          codes={codes}
          setCodes={setCodes}
          lessonCodes={lessonCodes}
          setLessonCodes={setLessonCodes}
          content={content}
          setContent={setContent}
          exams={exams}
          setExams={setExams}
          library={library}
          setLibrary={setLibrary}
          lastBackupAt={lastBackupAt}
          onExportBackup={exportAdminBackup}
        />
      ) : (
        studentView === 'profile' ? (
          <StudentPortalScreen
            profile={session.profile}
            onOpenLibrary={() => {
              setStudentView('library');
              setShowStudentSessionBadge(true);
            }}
          />
        ) : (
          <StudentDashboardTree
            profile={session.profile}
            library={library}
            setLibrary={setLibrary}
            accessRecords={session.access ?? []}
            studentToken={session.token}
            homeSignal={studentHomeSignal}
            onMainScreenChange={setShowStudentSessionBadge}
          />
        )
      )}
    </div>
  );
}

function TopBar({ theme, session, showSessionBadge, studentPortalActive, onToggleTheme, onLogout, onOpenStudentPortal, onHome }) {
  return (
    <header className="topbar">
      <button
        className={`brand-lockup ${session?.role === 'student' ? 'brand-home-button' : ''}`}
        type="button"
        onClick={session?.role === 'student' ? onHome : undefined}
      >
        <span className="brand-mark brand-logo" aria-hidden="true">
          <span className="brand-logo-ring" />
          <GraduationCap size={18} />
        </span>
        <div>
          <strong>THANWYA</strong>
          <span>منصة الثانوية والإعدادية</span>
        </div>
      </button>

      <div className="top-actions">
        {session && showSessionBadge && (
          <span className="session-badge">
            {session.role === 'admin' ? 'لوحة الإدارة' : session.profile.name}
          </span>
        )}
        {session?.role !== 'admin' && (
          <button
            className={`icon-button student-entry-button ${studentPortalActive ? 'active' : ''}`}
            type="button"
            onClick={onOpenStudentPortal}
            title="Student profile"
            aria-label="Student profile"
          >
            <User size={19} aria-hidden="true" />
          </button>
        )}
        <button
          className="icon-button"
          type="button"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
          aria-label={theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        {session && (
          <button className="button button-ghost" type="button" onClick={onLogout}>
            <LogOut size={18} aria-hidden="true" />
            خروج
          </button>
        )}
      </div>
    </header>
  );
}

function AuthScreen({ onLogin, onOpenStudentPortal, adminConfigured = true, onBootstrap }) {
  const [accessCode, setAccessCode] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [bootstrapCode, setBootstrapCode] = useState('');
  const [bootstrapError, setBootstrapError] = useState('');
  const [error, setError] = useState('');
  const accessTiles = [
    { icon: Video, title: 'دروس Streaming', text: 'جلسات مشاهدة مرتبة لكل سنة وشعبة.' },
    { icon: FileText, title: 'ملفات PDF', text: 'مذكرات ومراجعات سريعة داخل نفس المسار.' },
    { icon: ClipboardList, title: 'امتحانات', text: 'اختبارات قصيرة ومحتوى مخصص لكل طالب.' },
  ];

  async function submitCode(event) {
    event.preventDefault();
    const loginError = await onLogin(accessCode);
    setError(loginError);
  }

  async function submitBootstrap(event) {
    event.preventDefault();
    const bootstrapErrorMessage = await onBootstrap?.({
      bootstrapToken,
      adminCode: bootstrapCode,
    }) ?? '';
    setBootstrapError(bootstrapErrorMessage);
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel primary-panel auth-hero-panel">
        <div className="panel-kicker">
          <Video size={18} aria-hidden="true" />
          منصة منظمة وسهلة
        </div>
        <div className="auth-hero-copy">
          <h1>THANWYA</h1>
          <p>
            منصة تعليمية للإعدادي والثانوي، مصممة حول المشاهدة السريعة، الأكواد الخاصة، وتوزيع المحتوى بدقة حسب
            السنة والشعبة.
          </p>
        </div>

        <div className="auth-callout-box">
          <strong>دخول الطالب صار من الأيقونة العلوية</strong>
          <p>اضغط على أيقونة الطالب بجانب وضع الليل لفتح الملف الشخصي أو إدخال كود الطالب.</p>
          <button className="button button-secondary auth-telegram-button" type="button" onClick={onOpenStudentPortal}>
            <User size={18} aria-hidden="true" />
            افتح ملف الطالب
          </button>
        </div>

        <div className="auth-chip-row">
          <span>ثانية إعدادي</span>
          <span>ثالثة إعدادي</span>
          <span>أولى ثانوي</span>
          <span>ثانية ثانوي</span>
          <span>ثالثة ثانوي</span>
        </div>

        <form className="stack auth-entry-form auth-admin-form" onSubmit={submitCode}>
          <label>
            كود الإدارة
            <input
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="اكتب كود الأدمن"
              autoComplete="one-time-code"
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="button button-primary auth-submit" type="submit">
            <LogIn size={18} aria-hidden="true" />
            دخول الإدارة
          </button>
        </form>

        {!adminConfigured && (
          <form className="stack auth-entry-form auth-admin-form" onSubmit={submitBootstrap}>
            <label>
              Bootstrap token
              <input
                value={bootstrapToken}
                onChange={(event) => setBootstrapToken(event.target.value)}
                placeholder="ADMIN_BOOTSTRAP_TOKEN"
                autoComplete="off"
              />
            </label>
            <label>
              Admin code
              <input
                value={bootstrapCode}
                onChange={(event) => setBootstrapCode(event.target.value)}
                placeholder="Create a strong admin code"
                autoComplete="new-password"
              />
            </label>
            {bootstrapError && <p className="error-text">{bootstrapError}</p>}
            <button className="button button-secondary auth-submit" type="submit">
              <UserPlus size={18} aria-hidden="true" />
              تهيئة الإدارة
            </button>
          </form>
        )}
      </section>

      <section className="auth-panel auth-side-panel">
        <div className="panel-kicker">تجربة المنصة</div>
        <h2>الطالب له ملف مستقل، والإدارة لها دخول خاص</h2>
        <p>الطالب يفتح ملفه من الأيقونة العلوية ويدخل بكوده، أما الأدمن فيدخل من هذه الشاشة مباشرة.</p>

        <div className="auth-preview-grid">
          {accessTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <article className="auth-preview-card" key={tile.title}>
                <span className="auth-preview-icon">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <strong>{tile.title}</strong>
                <p>{tile.text}</p>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function StudentPortalScreen({ profile = null, onLogin, onOpenLibrary }) {
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');

  async function submitStudentLogin(event) {
    event.preventDefault();
    const loginError = (await onLogin?.(accessCode)) ?? '';
    setError(loginError);
  }

  if (!profile) {
    return (
      <main className="student-profile-layout">
        <section className="student-profile-heading">
          <div>
            <h1>الملف الشخصي</h1>
            <p>من هنا تقدر تدخل بكودك وتشوف بياناتك وحالة حسابك بشكل واضح.</p>
          </div>
          <span className="student-profile-heading-line" aria-hidden="true" />
        </section>

        <section className="student-profile-shell">
          <article className="student-profile-hero">
            <div className="student-profile-avatar">S</div>
            <div className="student-profile-copy">
              <span className="student-profile-badge">Student</span>
              <h2>ادخل بكود الطالب</h2>
              <p>اكتب الكود الذي أعطاه لك الأدمن عشان يفتح ملفك ومكتبتك.</p>
            </div>
          </article>

          <div className="student-profile-grid">
            <section className="student-profile-card login-card wide">
              <div className="profile-card-icon">
                <KeyRound size={22} aria-hidden="true" />
              </div>
              <div className="profile-card-body">
                <span>دخول الطالب</span>
                <form className="stack" onSubmit={submitStudentLogin}>
                  <input
                    value={accessCode}
                    onChange={(event) => setAccessCode(event.target.value)}
                    placeholder="اكتب كود الطالب"
                    autoComplete="one-time-code"
                  />
                  {error && <p className="error-text">{error}</p>}
                  <button className="button button-primary auth-submit" type="submit">
                    <LogIn size={18} aria-hidden="true" />
                    افتح الملف
                  </button>
                </form>
              </div>
            </section>

            <article className="student-profile-card">
              <div className="profile-card-icon">
                <ShieldCheck size={22} aria-hidden="true" />
              </div>
              <div className="profile-card-body">
                <span>حالة الحساب</span>
                <strong>يظهر بعد تسجيل الدخول</strong>
              </div>
            </article>

            <article className="student-profile-card">
              <div className="profile-card-icon">
                <GraduationCap size={22} aria-hidden="true" />
              </div>
              <div className="profile-card-body">
                <span>الشعبة</span>
                <strong>تجلب تلقائياً من بيانات الكود</strong>
              </div>
            </article>
          </div>
        </section>
      </main>
    );
  }

  const level = levelById(profile.level);
  const avatarLetter = String(profile.name ?? 'S').trim().charAt(0).toUpperCase();
  const studentCards = [
    {
      icon: GraduationCap,
      label: 'الشعبة',
      value: studentPathLabel(profile),
    },
    {
      icon: KeyRound,
      label: 'كود الطالب',
      value: profile.code,
      action: <CopyButton value={profile.code} compact />,
    },
    {
      icon: ShieldCheck,
      label: 'حالة الحساب',
      value: 'مفعل ونشط',
      tone: 'success',
    },
    {
      icon: User,
      label: 'المرحلة',
      value: level.name,
    },
    {
      icon: CalendarDays,
      label: 'تاريخ إنشاء الكود',
      value: formatDateOnly(profile.createdAt),
    },
    {
      icon: BadgeCheck,
      label: 'آخر تفعيل',
      value: formatDate(profile.activatedAt),
    },
  ];

  return (
    <main className="student-profile-layout">
      <section className="student-profile-heading">
        <div>
          <h1>الملف الشخصي</h1>
          <p>هنا هتقدر تعرف بيانات حسابك وكودك وحالة الوصول بشكل واضح وسريع.</p>
        </div>
        <span className="student-profile-heading-line" aria-hidden="true" />
      </section>

      <section className="student-profile-shell">
        <article className="student-profile-hero">
          <div className="student-profile-avatar">{avatarLetter}</div>
          <div className="student-profile-copy">
            <span className="student-profile-badge">اشتراك</span>
            <h2>{profile.name}</h2>
            <p>دي أهم بيانات حسابك على المنصة بشكل واضح وسريع.</p>
          </div>
        </article>

        <div className="student-profile-grid">
          {studentCards.map((card) => {
            const Icon = card.icon;
            const cardClass = 'student-profile-card' + (card.tone ? ' tone-' + card.tone : '');
            return (
              <article className={cardClass} key={card.label}>
                <div className="profile-card-icon">
                  <Icon size={22} aria-hidden="true" />
                </div>
                <div className="profile-card-body">
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </div>
                {card.action ? <div className="profile-card-action">{card.action}</div> : null}
              </article>
            );
          })}
        </div>

        <div className="student-profile-footer">
          <button className="button button-primary" type="button" onClick={onOpenLibrary}>
            <LibraryBig size={18} aria-hidden="true" />
            ادخل المكتبة
          </button>
        </div>
      </section>
    </main>
  );
}

function AdminDashboard({ codes, setCodes, lessonCodes, setLessonCodes, content, setContent, exams, setExams, library, setLibrary, lastBackupAt, onExportBackup }) {
  const [activeTab, setActiveTab] = useState('overview');
  const stats = useMemo(
    () => [
      { label: 'طلاب مسجلين', value: codes.filter((item) => item.status === 'active').length, icon: Users },
      { label: 'أكواد جاهزة', value: codes.filter((item) => item.status === 'unused').length, icon: KeyRound },
      { label: 'محتوى منشور', value: content.filter((item) => item.status === 'published').length, icon: LibraryBig },
      { label: 'امتحانات مفتوحة', value: exams.filter((item) => item.status === 'open').length, icon: ClipboardList },
    ],
    [codes, content, exams],
  );

  const tabs = [
    { id: 'overview', label: 'نظرة عامة', icon: Eye },
    { id: 'codes', label: 'أكواد الطلاب', icon: UserPlus },
    { id: 'lesson-codes', label: 'أكواد الحصص', icon: KeyRound },
    { id: 'library', label: 'الفولدرات', icon: FolderOpen },
    { id: 'content', label: 'المحتوى', icon: BookOpen },
    { id: 'exams', label: 'الامتحانات', icon: ClipboardList },
    { id: 'security', label: 'الحماية', icon: ShieldCheck },
  ];

  return (
    <main className="dashboard-layout">
      <aside className="sidebar">
        <div className="sidebar-title">لوحة الإدارة</div>
        <nav className="tab-list" aria-label="أقسام لوحة الإدارة">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={18} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="dashboard-main">
        {activeTab === 'overview' && <OverviewPanel stats={stats} codes={codes} content={content} lastBackupAt={lastBackupAt} onExportBackup={onExportBackup} />}
        {activeTab === 'codes' && <CodesPanel codes={codes} setCodes={setCodes} />}
        {activeTab === 'lesson-codes' && <LessonCodesPanel lessonCodes={lessonCodes} setLessonCodes={setLessonCodes} library={library} />}
        {activeTab === 'library' && <LibraryPanelTree library={library} setLibrary={setLibrary} lessonCodes={lessonCodes} setLessonCodes={setLessonCodes} />}
        {activeTab === 'content' && <ContentPanel content={content} setContent={setContent} />}
        {activeTab === 'exams' && <ExamsPanel exams={exams} setExams={setExams} />}
        {activeTab === 'security' && <SecurityPanel />}
      </section>
    </main>
  );
}

function OverviewPanel({ stats, codes, content, lastBackupAt, onExportBackup }) {
  const recentCodes = codes.slice(0, 4);
  const recentContent = content.slice(0, 4);

  return (
    <div className="stack spacious">
      <HeaderBlock
        icon={ShieldCheck}
        title="تشغيل المنصة"
        text="كل سنة وشعبة لها مسارها، ولوحة الإدارة تتحكم في الأكواد والمحتوى قبل ما يظهر للطلاب."
      />

      <section className="panel backup-panel">
        <div>
          <h3>حفظ بيانات الإدارة</h3>
          <p>{lastBackupAt ? `آخر نسخة تم تنزيلها: ${formatDate(lastBackupAt)}` : 'أول تعديل من الأدمن هيعمل تنزيل تلقائي لملف backup.'}</p>
        </div>
        <button className="button button-secondary" type="button" onClick={onExportBackup}>
          <FileText size={18} aria-hidden="true" />
          تنزيل نسخة Backup
        </button>
      </section>

      <div className="stats-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article className="stat-card" key={stat.label}>
              <Icon size={21} aria-hidden="true" />
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </article>
          );
        })}
      </div>

      <div className="split-grid">
        <section className="panel">
          <h3>آخر الأكواد</h3>
          <div className="item-list compact">
            {recentCodes.map((code) => (
              <div className="mini-row" key={code.id}>
                <span>{code.profile.name}</span>
                <strong>{code.value}</strong>
                <StatusPill status={code.status} />
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>آخر المحتوى</h3>
          <div className="item-list compact">
            {recentContent.map((item) => (
              <div className="mini-row" key={item.id}>
                <span className="with-icon">
                  <TypeIcon type={item.type} />
                  {item.title}
                </span>
                <strong>{audienceLabel(item)}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function CodesPanel({ codes, setCodes }) {
  const [form, setForm] = useState({
    name: '',
    level: 'secondary-3',
    track: 'science',
    major: 'math',
  });
  const [generated, setGenerated] = useState('');

  function submitCode(event) {
    event.preventDefault();
    const profile = audienceFromForm(form);
    const level = levelById(profile.level);
    const code = {
      id: createId('code'),
      value: createStudentAccessCode(codes),
      status: 'unused',
      createdAt: new Date().toISOString(),
      activatedAt: '',
      profile: {
        name: form.name.trim(),
        ...profile,
      },
    };

    setCodes((items) => [code, ...items]);
    setGenerated(code.value);
    setForm((current) => ({ ...current, name: '' }));
  }

  function toggleCodeStatus(codeId) {
    setCodes((items) =>
      items.map((item) => {
        if (item.id !== codeId) return item;
        return { ...item, status: item.status === 'disabled' ? 'active' : 'disabled' };
      }),
    );
  }

  return (
    <div className="stack spacious">
      <HeaderBlock
        icon={UserPlus}
        title="أكواد الطلاب"
        text="كل كود مرتبط باسم طالب وسنة وشعبة، والطالب لا يرى غير المحتوى المطابق لبياناته."
      />

      <section className="panel">
        <form className="form-grid" onSubmit={submitCode}>
          <label>
            اسم الطالب
            <input
              required
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="اكتب اسم الطالب"
            />
          </label>
          <AudienceFields form={form} setForm={setForm} />
          <button className="button button-primary form-submit" type="submit">
            <Plus size={18} aria-hidden="true" />
            توليد كود
          </button>
        </form>

        {generated && (
          <div className="generated-code">
            <span>الكود الجديد</span>
            <strong>{generated}</strong>
            <CopyButton value={generated} />
          </div>
        )}
      </section>

      <section className="panel">
        <h3>قائمة الأكواد</h3>
        <div className="table-list">
          {codes.map((code) => (
            <article className="data-row" key={code.id}>
              <div>
                <strong>{code.profile.name}</strong>
                <span>{audienceLabel({ ...code.profile, status: 'published' })}</span>
              </div>
              <code>{code.value}</code>
              <StatusPill status={code.status} />
              <span className="muted">{formatDate(code.activatedAt)}</span>
              <div className="row-actions">
                <CopyButton value={code.value} compact />
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => toggleCodeStatus(code.id)}
                  title={code.status === 'disabled' ? 'تفعيل الكود' : 'إيقاف الكود'}
                  aria-label={code.status === 'disabled' ? 'تفعيل الكود' : 'إيقاف الكود'}
                >
                  <RefreshCw size={17} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function LessonCodesPanel({ lessonCodes, setLessonCodes, library }) {
  const [subjectId, setSubjectId] = useState(library[0]?.id ?? '');
  const [teacherId, setTeacherId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');

  const selectedSubject = library.find((subject) => subject.id === subjectId) ?? library[0] ?? null;
  const selectedTeacher = selectedSubject?.teachers.find((teacher) => teacher.id === teacherId) ?? selectedSubject?.teachers[0] ?? null;
  const selectedLessons = useMemo(() => {
    const walk = (folders, acc = []) => {
      for (const folder of folders ?? []) {
        acc.push(folder);
        walk(folder.children ?? [], acc);
      }
      return acc;
    };
    return selectedTeacher ? walk(normalizeFolderList(selectedTeacher.lessons), []) : [];
  }, [selectedTeacher]);
  const selectedLesson = selectedLessons.find((lesson) => lesson.id === lessonId) ?? selectedLessons[0] ?? null;

  useEffect(() => {
    if (!selectedSubject && library[0]) setSubjectId(library[0].id);
    if (selectedSubject && !selectedSubject.teachers.some((teacher) => teacher.id === teacherId)) {
      setTeacherId(selectedSubject.teachers[0]?.id ?? '');
    }
  }, [library, selectedSubject, teacherId]);

  useEffect(() => {
    setLessonId(selectedLessons[0]?.id ?? '');
  }, [selectedTeacher, selectedLessons]);

  function generateLessonCode() {
    const code = createLessonCodeEntry({ lesson: selectedLesson, subject: selectedSubject, teacher: selectedTeacher });
    if (!code) return;
    setLessonCodes((items) => [code, ...items]);
    setGeneratedCode(code.value);
  }

  return (
    <div className="stack spacious">
      <HeaderBlock
        icon={KeyRound}
        title="أكواد الحصص"
        text="اختار اسم المادة ثم المدرس، وبعدها ولّد كود الحصة وانسخه مباشرة من المربع جنب الكود."
      />

      <section className="panel">
        <div className="form-grid lesson-code-form">
          <label>
            اسم المادة
            <select value={subjectId} onChange={(e) => {
              setSubjectId(e.target.value);
              const nextSubject = library.find((subject) => subject.id === e.target.value);
              setTeacherId(nextSubject?.teachers[0]?.id ?? '');
            }}>
              {(library.length ? library : []).map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            المدرس
            <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              {(selectedSubject?.teachers ?? []).map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            الحصة
            <select value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
              {selectedLessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  {lesson.title}
                </option>
              ))}
            </select>
          </label>

          <button className="button button-primary form-submit" type="button" onClick={generateLessonCode} disabled={!selectedLesson || !selectedTeacher}>
            توليد كود
          </button>
        </div>

        {generatedCode && (
            <div className="generated-code lesson-code-box">
            <span>الكود الجديد</span>
            <strong>{generatedCode}</strong>
            <CopyButton value={generatedCode} />
          </div>
        )}
      </section>

      <section className="panel">
        <h3>أكواد الحصص المحفوظة</h3>
        <div className="table-list">
          {lessonCodes.map((item) => (
            <article className="data-row lesson-code-row" key={item.id}>
              <div>
                <strong>{item.lessonTitle ?? item.subjectName}</strong>
                <span>{`${item.subjectName} / ${item.teacherName}`}</span>
              </div>
              <code>{item.value}</code>
              <CopyButton value={item.value} compact />
              <StatusPill status={item.status === 'claimed' ? 'closed' : item.status} />
              <span className="muted">{formatDate(item.createdAt)}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ContentPanel({ content, setContent }) {
  const [form, setForm] = useState({
    type: 'video',
    title: '',
    subject: '',
    level: 'secondary-3',
    track: 'science',
    major: 'math',
    meta: '',
    secure: true,
    status: 'published',
    url: 'private://streams/thanwya/',
    description: '',
  });

  function setType(type) {
    setForm((current) => ({
      ...current,
      type,
      secure: type === 'video',
      url: type === 'pdf' ? 'private://docs/thanwya/' : 'private://streams/thanwya/',
      meta: '',
    }));
  }

  function submitContent(event) {
    event.preventDefault();
    const item = {
      id: createId(form.type),
      ...form,
      title: form.title.trim(),
      subject: form.subject.trim(),
      description: form.description.trim(),
      createdAt: new Date().toISOString(),
    };
    setContent((items) => [item, ...items]);
    setForm((current) => ({
      ...current,
      title: '',
      subject: '',
      meta: '',
      description: '',
    }));
  }

  function removeContent(itemId) {
    setContent((items) => items.filter((item) => item.id !== itemId));
  }

  return (
    <div className="stack spacious">
      <HeaderBlock
        icon={BookOpen}
        title="المحتوى"
        text="أضف فيديوهات، ملفات PDF، أو محتوى مساعد واربطه بالسنة والشعبة المطلوبة."
      />

      <section className="panel">
        <form className="stack" onSubmit={submitContent}>
          <div className="segmented" role="group" aria-label="نوع المحتوى">
            {[
              { id: 'video', label: 'فيديو', icon: Video },
              { id: 'pdf', label: 'PDF', icon: FileText },
            ].map((type) => {
              const Icon = type.icon;
              return (
                <button
                  key={type.id}
                  className={form.type === type.id ? 'active' : ''}
                  type="button"
                  onClick={() => setType(type.id)}
                >
                  <Icon size={17} aria-hidden="true" />
                  {type.label}
                </button>
              );
            })}
          </div>

          <div className="form-grid">
            <label>
              العنوان
              <input
                required
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="عنوان المحتوى"
              />
            </label>
            <label>
              المادة
              <input
                required
                value={form.subject}
                onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
                placeholder="مثال: رياضيات"
              />
            </label>
            <AudienceFields form={form} setForm={setForm} />
            <label>
              بيانات مختصرة
              <input
                value={form.meta}
                onChange={(event) => setForm((current) => ({ ...current, meta: event.target.value }))}
                placeholder={form.type === 'video' ? 'مثال: 45 دقيقة' : 'مثال: 16 صفحة'}
              />
            </label>
            <label>
              مسار التخزين الخاص
              <input
                value={form.url}
                onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                placeholder="private://..."
              />
            </label>
            <label>
              حالة النشر
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
              >
                <option value="published">منشور</option>
                <option value="draft">مسودة</option>
              </select>
            </label>
          </div>

          <label>
            وصف قصير
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              rows="3"
              placeholder="ملاحظات تظهر داخل كارت المحتوى"
            />
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={form.secure}
              onChange={(event) => setForm((current) => ({ ...current, secure: event.target.checked }))}
            />
            تشغيل محمي بجلسة ومفتاح متغير
          </label>

          <button className="button button-primary align-start" type="submit">
            <Plus size={18} aria-hidden="true" />
            إضافة المحتوى
          </button>
        </form>
      </section>

      <section className="panel">
        <h3>مكتبة المحتوى</h3>
        <div className="table-list">
          {content.map((item) => (
            <article className="data-row content-admin-row" key={item.id}>
              <div className="title-cell">
                <span className="type-badge">
                  <TypeIcon type={item.type} />
                  {TYPE_LABELS[item.type]}
                </span>
                <strong>{item.title}</strong>
                <span>{item.subject} · {audienceLabel(item)}</span>
              </div>
              <StatusPill status={item.status} />
              {item.secure && <span className="secure-chip">Secure Stream</span>}
              <button
                className="icon-button danger"
                type="button"
                onClick={() => removeContent(item.id)}
                title="حذف المحتوى"
                aria-label="حذف المحتوى"
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ExamsPanel({ exams, setExams }) {
  const [form, setForm] = useState({
    title: '',
    subject: '',
    level: 'secondary-3',
    track: 'science',
    major: 'math',
    minutes: 30,
    status: 'open',
  });
  const [questions, setQuestions] = useState([createEmptyQuestion(0)]);

  function updateQuestion(questionId, updater) {
    setQuestions((items) => items.map((question) => (question.id === questionId ? updater(question) : question)));
  }

  function addQuestion() {
    setQuestions((items) => [...items, createEmptyQuestion(items.length)]);
  }

  function removeQuestion(questionId) {
    setQuestions((items) => (items.length === 1 ? items : items.filter((question) => question.id !== questionId)));
  }

  function submitExam(event) {
    event.preventDefault();
    const exam = {
      id: createId('exam'),
      ...form,
      title: form.title.trim(),
      subject: form.subject.trim(),
      minutes: Number(form.minutes),
      questions: questions.length,
      questionsData: normalizeQuestions(questions),
      createdAt: new Date().toISOString(),
    };
    setExams((items) => [exam, ...items]);
    setForm((current) => ({ ...current, title: '', subject: '' }));
    setQuestions([createEmptyQuestion(0)]);
  }

  function removeExam(examId) {
    setExams((items) => items.filter((item) => item.id !== examId));
  }

  return (
    <div className="stack spacious">
      <HeaderBlock
        icon={ClipboardList}
        title="الامتحانات"
        text="اربط كل امتحان بالسنة والشعبة، وسيظهر تلقائيًا للطلاب المناسبين فقط."
      />

      <section className="panel">
        <form className="form-grid" onSubmit={submitExam}>
          <label>
            اسم الامتحان
            <input
              required
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="عنوان الامتحان"
            />
          </label>
          <label>
            المادة
            <input
              required
              value={form.subject}
              onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
              placeholder="مثال: فيزياء"
            />
          </label>
          <AudienceFields form={form} setForm={setForm} />
          <label>
            الوقت بالدقائق
            <input
              type="number"
              min="1"
              value={form.minutes}
              onChange={(event) => setForm((current) => ({ ...current, minutes: event.target.value }))}
            />
          </label>
          <label>
            الحالة
            <select
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="open">مفتوح</option>
              <option value="closed">مغلق</option>
            </select>
          </label>
          <button className="button button-primary form-submit" type="submit">
            <Plus size={18} aria-hidden="true" />
            إضافة امتحان
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="library-block-header">
          <div>
            <span>باني الأسئلة</span>
            <h3>أسئلة الاختيار من متعدد</h3>
          </div>
          <button className="button button-secondary" type="button" onClick={addQuestion}>
            <Plus size={18} aria-hidden="true" />
            إضافة سؤال
          </button>
        </div>
        <div className="stack spacious">
          {questions.map((question, index) => (
            <article className="question-builder-card" key={question.id}>
              <div className="question-builder-head">
                <strong>سؤال {index + 1}</strong>
                <button className="icon-button danger" type="button" onClick={() => removeQuestion(question.id)} aria-label="حذف السؤال">
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
              <input
                value={question.text}
                onChange={(event) => updateQuestion(question.id, (current) => ({ ...current, text: event.target.value }))}
                placeholder="نص السؤال"
              />
              <div className="question-options-grid">
                {question.options.map((option, optionIndex) => (
                  <label key={`${question.id}-${optionIndex}`} className="question-option-row">
                    <input
                      value={option}
                      onChange={(event) =>
                        updateQuestion(question.id, (current) => ({
                          ...current,
                          options: current.options.map((item, idx) => (idx === optionIndex ? event.target.value : item)),
                        }))
                      }
                      placeholder={`الاختيار ${optionIndex + 1}`}
                    />
                    <input
                      type="radio"
                      name={`correct-${question.id}`}
                      checked={question.correctIndex === optionIndex}
                      onChange={() => updateQuestion(question.id, (current) => ({ ...current, correctIndex: optionIndex }))}
                    />
                    <span>صحيحة</span>
                  </label>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>قائمة الامتحانات</h3>
        <div className="table-list">
          {exams.map((exam) => (
            <article className="data-row" key={exam.id}>
              <div>
                <strong>{exam.title}</strong>
                <span>{exam.subject} · {audienceLabel(exam)}</span>
              </div>
              <span>{(exam.questionsData?.length ?? exam.questions) || 0} سؤال</span>
              <span>{exam.minutes} دقيقة</span>
              <StatusPill status={exam.status} />
              <button
                className="icon-button danger"
                type="button"
                onClick={() => removeExam(exam.id)}
                title="حذف الامتحان"
                aria-label="حذف الامتحان"
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function LibraryPanel({ library, setLibrary }) {
  const [subjectId, setSubjectId] = useState(library[0]?.id ?? '');
  const [teacherId, setTeacherId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [teacherForm, setTeacherForm] = useState({ name: '', image: '', imageFile: null, imageFileName: '' });
  const [lessonForm, setLessonForm] = useState({ title: '', subtitle: '', cover: '' });
  const [resourceForm, setResourceForm] = useState({
    videoTitle: '',
    videoDuration: '',
    pdfTitle: '',
    pdfPages: '',
    examTitle: '',
    examQuestions: '',
    examMinutes: '',
  });

  const selectedSubject = library.find((subject) => subject.id === subjectId) ?? library[0] ?? null;
  const selectedTeacher = selectedSubject?.teachers.find((teacher) => teacher.id === teacherId) ?? selectedSubject?.teachers[0] ?? null;
  const selectedLesson = selectedTeacher?.lessons.find((lesson) => lesson.id === lessonId) ?? selectedTeacher?.lessons[0] ?? null;

  useEffect(() => {
    if (!selectedSubject && library[0]) {
      setSubjectId(library[0].id);
      return;
    }

    if (selectedSubject && !selectedSubject.teachers.find((teacher) => teacher.id === teacherId)) {
      setTeacherId(selectedSubject.teachers[0]?.id ?? '');
    }
  }, [library, selectedSubject, teacherId]);

  useEffect(() => {
    if (selectedTeacher && !selectedTeacher.lessons.find((lesson) => lesson.id === lessonId)) {
      setLessonId(selectedTeacher.lessons[0]?.id ?? '');
    }
  }, [selectedTeacher, lessonId]);

  function updateSubject(subjectTargetId, updater) {
    setLibrary((items) =>
      items.map((subject) => (subject.id === subjectTargetId ? updater(subject) : subject)),
    );
  }

  function updateTeacher(subjectTargetId, teacherTargetId, updater) {
    updateSubject(subjectTargetId, (subject) => ({
      ...subject,
      teachers: subject.teachers.map((teacher) => (teacher.id === teacherTargetId ? updater(teacher) : teacher)),
    }));
  }

  function updateLesson(subjectTargetId, teacherTargetId, lessonTargetId, updater) {
    updateTeacher(subjectTargetId, teacherTargetId, (teacher) => ({
      ...teacher,
      lessons: teacher.lessons.map((lesson) => (lesson.id === lessonTargetId ? updater(lesson) : lesson)),
    }));
  }

  function moveItem(items, itemId, direction) {
    const index = items.findIndex((item) => item.id === itemId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next.map((item, order) => ({ ...item, number: item.number ? order + 1 : item.number }));
  }

  function submitTeacher(event) {
    event.preventDefault();
    if (!selectedSubject || !teacherForm.name.trim()) return;
    const teacherImage =
      teacherForm.imageFile ||
      teacherForm.image.trim() ||
      'https://api.dicebear.com/9.x/personas/svg?seed=' + encodeURIComponent(teacherForm.name.trim()) + '&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf';
    const teacher = {
      id: createId('teacher'),
      name: teacherForm.name.trim(),
      role: 'مدرس المادة',
      image: teacherImage,
      lessons: [],
    };
    updateSubject(selectedSubject.id, (subject) => ({ ...subject, teachers: [...subject.teachers, teacher] }));
    setTeacherId(teacher.id);
    setFolderPath([]);
    setTeacherForm({ name: '', image: '', imageFile: null, imageFileName: '' });
  }

  async function handleTeacherImageFile(file) {
    if (!file) return;
    const image = await readFileAsDataUrl(file);
    setTeacherForm((current) => ({
      ...current,
      image,
      imageFile: file,
      imageFileName: file.name,
    }));
  }

  function removeTeacher(teacherTargetId) {
    if (!selectedSubject) return;
    updateSubject(selectedSubject.id, (subject) => ({
      ...subject,
      teachers: subject.teachers.filter((teacher) => teacher.id !== teacherTargetId),
    }));
  }

  function submitLesson(event) {
    event.preventDefault();
    if (!selectedSubject || !selectedTeacher || !lessonForm.title.trim()) return;
    const lesson = {
      id: createId('lesson'),
      number: selectedTeacher.lessons.length + 1,
      title: lessonForm.title.trim(),
      subtitle: lessonForm.subtitle.trim() || 'محتوى جديد',
      cover: lessonForm.cover.trim() || `https://picsum.photos/seed/${Date.now()}/900/520`,
      videos: [],
      pdfs: [],
      exams: [],
    };
    updateTeacher(selectedSubject.id, selectedTeacher.id, (teacher) => ({
      ...teacher,
      lessons: [...teacher.lessons, lesson],
    }));
    setLessonId(lesson.id);
    setLessonForm({ title: '', subtitle: '', cover: '' });
  }

  function removeLesson(lessonTargetId) {
    if (!selectedSubject || !selectedTeacher) return;
    updateTeacher(selectedSubject.id, selectedTeacher.id, (teacher) => ({
      ...teacher,
      lessons: teacher.lessons
        .filter((lesson) => lesson.id !== lessonTargetId)
        .map((lesson, index) => ({ ...lesson, number: index + 1 })),
    }));
  }

  function addResource(type) {
    if (!selectedSubject || !selectedTeacher || !selectedLesson) return;

    if (type === 'video' && resourceForm.videoTitle.trim()) {
      updateLesson(selectedSubject.id, selectedTeacher.id, selectedLesson.id, (lesson) => ({
        ...lesson,
        videos: [
          ...lesson.videos,
          {
            id: createId('video'),
            title: resourceForm.videoTitle.trim(),
            duration: resourceForm.videoDuration.trim() || '25 دقيقة',
            poster: lessonForm.cover.trim() || lesson.cover,
            summary: `شرح ${selectedSubject.name} مع ${selectedTeacher.name}.`,
          },
        ],
      }));
      setResourceForm((current) => ({ ...current, videoTitle: '', videoDuration: '' }));
    }

    if (type === 'pdf' && resourceForm.pdfTitle.trim()) {
      updateLesson(selectedSubject.id, selectedTeacher.id, selectedLesson.id, (lesson) => ({
        ...lesson,
        pdfs: [
          ...lesson.pdfs,
          {
            id: createId('pdf'),
            title: resourceForm.pdfTitle.trim(),
            pages: Number(resourceForm.pdfPages) || 10,
            summary: 'ملف مضاف من لوحة الأدمن.',
          },
        ],
      }));
      setResourceForm((current) => ({ ...current, pdfTitle: '', pdfPages: '' }));
    }

    if (type === 'exam' && examDraft.title.trim()) {
      updateLesson(selectedSubject.id, selectedTeacher.id, selectedLesson.id, (lesson) => ({
        ...lesson,
        exams: [
          ...lesson.exams,
          {
            id: createId('exam'),
            title: resourceForm.examTitle.trim(),
            questions: Number(resourceForm.examQuestions) || 10,
            minutes: Number(resourceForm.examMinutes) || 20,
          },
        ],
      }));
      setResourceForm((current) => ({
        ...current,
        examTitle: '',
        examQuestions: '',
        examMinutes: '',
      }));
    }
  }

  function removeResource(type, resourceId) {
    if (!selectedSubject || !selectedTeacher || !selectedLesson) return;
    updateLesson(selectedSubject.id, selectedTeacher.id, selectedLesson.id, (lesson) => ({
      ...lesson,
      [type]: lesson[type].filter((item) => item.id !== resourceId),
    }));
  }

  function moveTeacher(teacherTargetId, direction) {
    if (!selectedSubject) return;
    updateSubject(selectedSubject.id, (subject) => ({
      ...subject,
      teachers: moveItem(subject.teachers, teacherTargetId, direction),
    }));
  }

  function moveLesson(lessonTargetId, direction) {
    if (!selectedSubject || !selectedTeacher) return;
    updateTeacher(selectedSubject.id, selectedTeacher.id, (teacher) => ({
      ...teacher,
      lessons: moveItem(teacher.lessons, lessonTargetId, direction),
    }));
  }

  return (
    <div className="stack spacious">
      <HeaderBlock
        icon={FolderOpen}
        title="الفولدرات والمدرسين"
        text="رتب المواد، أضف مدرسين، اعمل فولدرات حصص، وأدخل جوه كل حصة الفيديوهات والملفات والامتحانات."
      />

      <section className="admin-library-shell">
        <aside className="admin-subjects-panel panel">
          <h3>المواد</h3>
          <div className="admin-subject-list">
            {library.map((subject) => (
              <div className="admin-subject-row" key={subject.id}>
                <button
                  type="button"
                  className={`admin-subject-pill ${selectedSubject?.id === subject.id ? 'active' : ''}`}
                  onClick={() => setSubjectId(subject.id)}
                >
                  {subject.name}
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  onClick={() => {
                    if (window.confirm(`حذف مادة ${subject.name} بالكامل؟`)) {
                      removeSubject(subject.id);
                    }
                  }}
                  aria-label={`حذف مادة ${subject.name}`}
                  title="حذف المادة بالكامل"
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <div className="admin-library-main">
          {selectedSubject && (
            <section className="panel library-panel-block">
              <div className="library-block-header">
                <div>
                  <span>مدرسين المادة</span>
                  <h3>{selectedSubject.name}</h3>
                </div>
              </div>

              <form className="form-grid" onSubmit={submitTeacher}>
                <label>
                  اسم المدرس
                  <input value={teacherForm.name} onChange={(e) => setTeacherForm((c) => ({ ...c, name: e.target.value }))} />
                </label>
                <label>
                  صورة المدرس
                  <input value={teacherForm.image} onChange={(e) => setTeacherForm((c) => ({ ...c, image: e.target.value, imageFile: null, imageFileName: '' }))} placeholder="https://..." />
                </label>
                <label>
                  أو ارفع صورة
                  <input type="file" accept="image/*" onChange={(e) => handleTeacherImageFile(e.target.files?.[0] ?? null)} />
                </label>
                <button className="button button-primary form-submit" type="submit">
                  <Plus size={18} aria-hidden="true" />
                  إضافة مدرس
                </button>
              </form>

              <div className="admin-teacher-grid">
                {selectedSubject.teachers.map((teacher, index) => (
                  <article
                    className={`admin-teacher-card ${selectedTeacher?.id === teacher.id ? 'active' : ''}`}
                    key={teacher.id}
                  >
                    <button type="button" className="teacher-select-surface" onClick={() => setTeacherId(teacher.id)}>
                      <img src={teacher.image} alt={teacher.name} loading="lazy" />
                      <div>
                        <strong>{teacher.name}</strong>
                        <span>{teacher.lessons.length} فولدر</span>
                      </div>
                    </button>
                    <div className="row-actions">
                      <button className="icon-button" type="button" onClick={() => moveTeacher(teacher.id, -1)} title="تحريك لأعلى" aria-label="تحريك لأعلى">
                        <ArrowLeft size={17} aria-hidden="true" />
                      </button>
                      <button className="icon-button" type="button" onClick={() => moveTeacher(teacher.id, 1)} title="تحريك لأسفل" aria-label="تحريك لأسفل">
                        <ArrowLeft size={17} aria-hidden="true" style={{ transform: 'rotate(180deg)' }} />
                      </button>
                      <button className="icon-button danger" type="button" onClick={() => removeTeacher(teacher.id)} title="حذف المدرس" aria-label="حذف المدرس">
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {selectedSubject && selectedTeacher && (
            <section className="panel library-panel-block">
              <div className="library-block-header">
                <div>
                  <span>فولدرات المدرس</span>
                  <h3>{selectedTeacher.name}</h3>
                </div>
              </div>

              <form className="form-grid" onSubmit={submitLesson}>
                <label>
                  اسم الفولدر / الحصة
                  <input
                    value={lessonForm.title}
                    onChange={(event) => setLessonForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="مثال: الفولدر الخامس"
                  />
                </label>
                <label>
                  وصف قصير
                  <input
                    value={lessonForm.subtitle}
                    onChange={(event) => setLessonForm((current) => ({ ...current, subtitle: event.target.value }))}
                    placeholder="مثال: مراجعة مركزة"
                  />
                </label>
                <label>
                  صورة الغلاف
                  <input
                    value={lessonForm.cover}
                    onChange={(event) => setLessonForm((current) => ({ ...current, cover: event.target.value }))}
                    placeholder="https://..."
                  />
                </label>
                <button className="button button-primary form-submit" type="submit">
                  <Plus size={18} aria-hidden="true" />
                  إضافة فولدر
                </button>
              </form>

              <div className="admin-lesson-grid">
                {selectedTeacher.lessons.map((lesson) => (
                  <article
                    className={`admin-lesson-card ${selectedLesson?.id === lesson.id ? 'active' : ''}`}
                    key={lesson.id}
                  >
                    <button type="button" className="lesson-select-surface" onClick={() => setLessonId(lesson.id)}>
                      <img src={lesson.cover} alt={lesson.title} loading="lazy" />
                      <div>
                        <strong>{lesson.title}</strong>
                        <span>{lesson.subtitle}</span>
                        <small>{`${lesson.videos.length} فيديو - ${lesson.pdfs.length} PDF - ${lesson.exams.length} امتحان`}</small>
                      </div>
                    </button>
                    <div className="row-actions">
                      <button className="icon-button" type="button" onClick={() => moveLesson(lesson.id, -1)} title="تحريك لأعلى" aria-label="تحريك لأعلى">
                        <ArrowLeft size={17} aria-hidden="true" />
                      </button>
                      <button className="icon-button" type="button" onClick={() => moveLesson(lesson.id, 1)} title="تحريك لأسفل" aria-label="تحريك لأسفل">
                        <ArrowLeft size={17} aria-hidden="true" style={{ transform: 'rotate(180deg)' }} />
                      </button>
                      <button className="icon-button danger" type="button" onClick={() => removeLesson(lesson.id)} title="حذف الفولدر" aria-label="حذف الفولدر">
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {selectedSubject && selectedTeacher && selectedLesson && (
            <section className="panel library-panel-block">
              <div className="library-block-header">
                <div>
                  <span>محتوى الفولدر</span>
                  <h3>{selectedLesson.title}</h3>
                </div>
                <div className="row-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      const nextCode = createLessonCodeEntry({ lesson: selectedLesson, subject: selectedSubject, teacher: selectedTeacher });
                      if (!nextCode) return;
                      setLessonCodes((items) => [nextCode, ...items.filter((item) => item.lessonId !== selectedLesson.id)]);
                    }}
                  >
                    توليد كود للحصة
                  </button>
                </div>
              </div>

              <div className="generated-code lesson-code-box">
                <span>كود الحصة</span>
                <strong>{selectedLessonCode?.value ?? 'لم يتم توليد كود بعد'}</strong>
                <StatusPill status={selectedLessonCode?.status === 'claimed' ? 'closed' : selectedLessonCode ? 'open' : 'draft'} />
              </div>

              <div className="resource-admin-shell">
                <div className="resource-admin-section">
                  <h4>الفيديوهات</h4>
                  <div className="resource-admin-form">
                    <input
                      value={resourceForm.videoTitle}
                      onChange={(event) => setResourceForm((current) => ({ ...current, videoTitle: event.target.value }))}
                      placeholder="اسم الفيديو"
                    />
                    <input
                      value={resourceForm.videoDuration}
                      onChange={(event) => setResourceForm((current) => ({ ...current, videoDuration: event.target.value }))}
                      placeholder="المدة"
                    />
                    <button className="button button-primary" type="button" onClick={() => addResource('video')}>
                      إضافة فيديو
                    </button>
                  </div>
                  <div className="table-list">
                    {selectedLesson.videos.map((video) => (
                      <article className="data-row" key={video.id}>
                        <div>
                          <strong>{video.title}</strong>
                          <span>{video.duration}</span>
                        </div>
                        <button className="icon-button danger" type="button" onClick={() => removeResource('videos', video.id)}>
                          <Trash2 size={17} aria-hidden="true" />
                        </button>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="resource-admin-section">
                  <h4>ملفات PDF</h4>
                  <div className="resource-admin-form">
                    <input
                      value={resourceForm.pdfTitle}
                      onChange={(event) => setResourceForm((current) => ({ ...current, pdfTitle: event.target.value }))}
                      placeholder="اسم الملف"
                    />
                    <input
                      value={resourceForm.pdfPages}
                      onChange={(event) => setResourceForm((current) => ({ ...current, pdfPages: event.target.value }))}
                      placeholder="عدد الصفحات"
                    />
                    <button className="button button-primary" type="button" onClick={() => addResource('pdf')}>
                      إضافة PDF
                    </button>
                  </div>
                  <div className="table-list">
                    {selectedLesson.pdfs.map((pdf) => (
                      <article className="data-row" key={pdf.id}>
                        <div>
                          <strong>{pdf.title}</strong>
                          <span>{pdf.pages} صفحة</span>
                        </div>
                        <button className="icon-button danger" type="button" onClick={() => removeResource('pdfs', pdf.id)}>
                          <Trash2 size={17} aria-hidden="true" />
                        </button>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="resource-admin-section">
                  <h4>الامتحانات</h4>
                  <div className="resource-admin-form triple">
                    <input
                      value={resourceForm.examTitle}
                      onChange={(event) => setResourceForm((current) => ({ ...current, examTitle: event.target.value }))}
                      placeholder="اسم الامتحان"
                    />
                    <input
                      value={resourceForm.examQuestions}
                      onChange={(event) => setResourceForm((current) => ({ ...current, examQuestions: event.target.value }))}
                      placeholder="عدد الأسئلة"
                    />
                    <input
                      value={resourceForm.examMinutes}
                      onChange={(event) => setResourceForm((current) => ({ ...current, examMinutes: event.target.value }))}
                      placeholder="الدقائق"
                    />
                    <button className="button button-primary" type="button" onClick={() => addResource('exam')}>
                      إضافة امتحان
                    </button>
                  </div>
                  <div className="table-list">
                    {selectedLesson.exams.map((exam) => (
                      <article className="data-row" key={exam.id}>
                        <div>
                          <strong>{exam.title}</strong>
                          <span>{`${exam.questions} سؤال - ${exam.minutes} دقيقة`}</span>
                        </div>
                        <button className="icon-button danger" type="button" onClick={() => removeResource('exams', exam.id)}>
                          <Trash2 size={17} aria-hidden="true" />
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function SecurityPanel() {
  const policies = [
    {
      title: 'جلسة تشغيل قصيرة',
      text: 'كل فيديو يبدأ بجلسة خاصة بالطالب، ومعها مفتاح يتغير أثناء التشغيل بدل رابط ثابت.',
      icon: KeyRound,
    },
    {
      title: 'HLS/DASH مشفر',
      text: 'الفيديو الإنتاجي يكون مقطعًا إلى أجزاء مشفرة، ومفاتيح التشغيل لا تخرج إلا بعد تحقق السيرفر.',
      icon: Video,
    },
    {
      title: 'علامة مائية',
      text: 'اسم الطالب والكود يظهران فوق المشغل لتقليل مشاركة الشاشة أو إعادة النشر.',
      icon: BadgeCheck,
    },
    {
      title: 'صلاحيات دقيقة',
      text: 'السنة والشعبة والكود يحددون المحتوى المسموح، ويمكن إيقاف أي كود من لوحة الإدارة.',
      icon: LockKeyhole,
    },
  ];

  return (
    <div className="stack spacious">
      <HeaderBlock
        icon={ShieldCheck}
        title="حماية البث"
        text="دي طبقة الواجهة. منع أدوات التحميل فعليًا يحتاج سيرفر يوقع الجلسات ويخفي ملفات الفيديو الأصلية."
      />

      <div className="policy-grid">
        {policies.map((policy) => {
          const Icon = policy.icon;
          return (
            <article className="policy-card" key={policy.title}>
              <Icon size={22} aria-hidden="true" />
              <h3>{policy.title}</h3>
              <p>{policy.text}</p>
            </article>
          );
        })}
      </div>

      <section className="panel security-flow">
        <h3>مسار التشغيل الإنتاجي</h3>
        <ol>
          <li>الطالب يطلب تشغيل فيديو من حسابه.</li>
          <li>السيرفر ينشئ playback session قصيرة ومربوطة بالكود والجهاز.</li>
          <li>الـ CDN يعيد playlist مشفرة فقط وليس ملف الفيديو الأصلي.</li>
          <li>مفتاح التشفير يتغير زمنيًا، والسيرفر يرفض المفاتيح القديمة أو الجلسات المسربة.</li>
          <li>العلامة المائية والحد الأقصى للجلسات يقللان تسريب الحساب.</li>
        </ol>
      </section>
    </div>
  );
}

function StudentDashboard({ profile, library, homeSignal }) {
  const level = levelById(profile.level);
  const track = trackById(profile.level, profile.track);
  const major = profile.major ? majorById(profile.level, profile.track, profile.major) : null;
  const studentLibrary = useMemo(
    () => filterLibraryForProfile(profile, library),
    [profile.level, profile.track, profile.major, library],
  );
  const [viewState, setViewState] = useState({
    screen: 'subjects',
    subjectId: '',
    teacherId: '',
    lessonId: '',
    videoId: '',
  });
  const selectedSubject = studentLibrary.find((subject) => subject.id === viewState.subjectId) ?? null;
  const selectedTeacher = selectedSubject?.teachers.find((teacher) => teacher.id === viewState.teacherId) ?? null;
  const selectedLesson = selectedTeacher?.lessons.find((lesson) => lesson.id === viewState.lessonId) ?? null;
  const selectedVideo = selectedLesson?.videos.find((video) => video.id === viewState.videoId) ?? selectedLesson?.videos[0] ?? null;

  useEffect(() => {
    setViewState({
      screen: 'subjects',
      subjectId: '',
      teacherId: '',
      lessonId: '',
      videoId: '',
    });
  }, [profile.level, profile.track, profile.major, homeSignal]);

  const heroStats = [
    { label: 'المواد', value: studentLibrary.length },
    { label: 'المدرسين', value: studentLibrary.reduce((total, subject) => total + subject.teachers.length, 0) },
    { label: 'الحصص', value: studentLibrary.reduce((total, subject) => total + subject.teachers.reduce((sum, teacher) => sum + teacher.lessons.length, 0), 0) },
    { label: 'الفيديوهات', value: studentLibrary.reduce((total, subject) => total + subject.teachers.reduce((teacherSum, teacher) => teacherSum + teacher.lessons.reduce((lessonSum, lesson) => lessonSum + lesson.videos.length, 0), 0), 0) },
  ];

  function openSubject(subject) {
    setViewState({
      screen: 'teachers',
      subjectId: subject.id,
      teacherId: '',
      lessonId: '',
      videoId: '',
    });
  }

  function openTeacher(teacher) {
    setViewState((current) => ({
      ...current,
      screen: 'lessons',
      teacherId: teacher.id,
      lessonId: '',
      videoId: '',
    }));
  }

  function openLesson(lesson) {
    setViewState((current) => ({
      ...current,
      screen: 'lesson-detail',
      lessonId: lesson.id,
      videoId: lesson.videos[0]?.id ?? '',
    }));
  }

  function selectVideo(video) {
    setViewState((current) => ({ ...current, videoId: video.id }));
  }

  function goBack() {
    setViewState((current) => {
      if (current.screen === 'lesson-detail') {
        return { ...current, screen: 'lessons', lessonId: '', videoId: '' };
      }

      if (current.screen === 'lessons') {
        return { ...current, screen: 'teachers', teacherId: '', lessonId: '', videoId: '' };
      }

      if (current.screen === 'teachers') {
        return { screen: 'subjects', subjectId: '', teacherId: '', lessonId: '', videoId: '' };
      }

      return current;
    });
  }

  return (
    <main className="student-layout">
      <section className="student-hero">
        <div className="student-summary">
          <div>
            <span className="panel-kicker">
              <GraduationCap size={18} aria-hidden="true" />
              صفحة الطالب
            </span>
            <h1>{profile.name}</h1>
            <p>{[level.name, track.id !== 'general' ? track.name : '', major?.name ?? ''].filter(Boolean).join(' / ')}</p>
          </div>
          <div className="student-code">
            <span>الكود</span>
            <strong>{profile.code}</strong>
          </div>
        </div>

        <div className="student-hero-stats">
          {heroStats.map((stat) => (
            <article className="student-stat" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </article>
          ))}
        </div>
      </section>

      <StudentBreadcrumb
        viewState={viewState}
        selectedSubject={selectedSubject}
        selectedTeacher={selectedTeacher}
        selectedLesson={selectedLesson}
      />

      {viewState.screen === 'subjects' && (
        <section className="catalog-screen">
          <SectionHeading
            eyebrow="المواد"
            title="اختر المادة"
            description="هتدخل على صفحة مستقلة فيها المدرسين الخاصين بالمادة، وبعدها تختار المدرس ثم الحصص."
          />
          <div className="collection-grid subjects-mode">
            {studentLibrary.map((subject) => (
              <article className="collection-card subject-showcase-card" key={subject.id}>
                <div className="collection-cover">
                  <img src={subject.cover} alt={subject.label} loading="lazy" />
                  <span className="collection-year">{subject.year}</span>
                </div>
                <div className="collection-content">
                  <h3>{subject.label}</h3>
                  <p>{subject.name}</p>
                  <div className="collection-meta">
                    <span>عدد المعلمين:</span>
                    <strong>{subject.teachers.length} معلمين</strong>
                  </div>
                  <button className="button collection-button" type="button" onClick={() => openSubject(subject)}>
                    شوف المدرسين
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {viewState.screen === 'teachers' && selectedSubject && (
        <section className="catalog-screen">
          <CatalogBackButton label="رجوع للمواد" onClick={goBack} />
          <SectionHeading
            eyebrow={selectedSubject.label}
            title={`مدرسين مادة ${selectedSubject.label}`}
            description="اختار المدرس المناسب ليك، وبعدها هتدخل على صفحة الحصص الخاصة بيه."
          />
          <div className="collection-grid teacher-mode">
            {selectedSubject.teachers.map((teacher) => (
              <article className="collection-card teacher-showcase-card" key={teacher.id}>
                <div className="collection-cover portrait">
                  <img src={teacher.image} alt={teacher.name} loading="lazy" />
                  <span className="collection-badge">مدرس</span>
                </div>
                <div className="collection-content">
                  <h3>{teacher.name}</h3>
                  <p>{teacher.role}</p>
                  <div className="collection-meta">
                    <span>عدد الفصول:</span>
                    <strong>{teacher.lessons.length} فصول</strong>
                  </div>
                  <button className="button collection-button" type="button" onClick={() => openTeacher(teacher)}>
                    شوف الفصول
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {viewState.screen === 'lessons' && selectedSubject && selectedTeacher && (
        <section className="catalog-screen">
          <CatalogBackButton label="رجوع للمدرسين" onClick={goBack} />
          <SectionHeading
            eyebrow={selectedSubject.label}
            title={`حصص ${selectedTeacher.name}`}
            description="كل مدرس فيه 4 حصص تجريبية، وكل حصة جواها فيديوهات وملفات PDF وامتحان خاص بها."
          />
          <div className="collection-grid lesson-mode">
            {selectedTeacher.lessons.map((lesson) => (
              <article className="collection-card lesson-showcase-card" key={lesson.id}>
                <div className="lesson-mini-head">
                  <span>{`الفصل ${lesson.number}`}</span>
                  <img src={lesson.cover} alt={lesson.title} loading="lazy" />
                </div>
                <div className="collection-content">
                  <h3>{lesson.title}</h3>
                  <p>{lesson.subtitle}</p>
                  <div className="lesson-stats-row">
                    <div>
                      <ClipboardList size={16} aria-hidden="true" />
                      <strong>{lesson.exams.length}</strong>
                      <span>امتحان</span>
                    </div>
                    <div>
                      <FileText size={16} aria-hidden="true" />
                      <strong>{lesson.pdfs.length}</strong>
                      <span>ملفات</span>
                    </div>
                    <div>
                      <Video size={16} aria-hidden="true" />
                      <strong>{lesson.videos.length}</strong>
                      <span>فيديو</span>
                    </div>
                  </div>
                  <button className="button collection-button" type="button" onClick={() => openLesson(lesson)}>
                    مشاهدة المحاضرة
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {viewState.screen === 'lesson-detail' && selectedSubject && selectedTeacher && selectedLesson && (
        <section className="catalog-screen detail-mode">
          <CatalogBackButton label="رجوع للحصص" onClick={goBack} />
          <SectionHeading
            eyebrow={selectedSubject.label}
            title={selectedLesson.title}
            description="جوه الحصة هتلاقي الفيديوهات، وملف الـ PDF، والامتحان الخاص بنفس الحصة."
          />

          <div className="lesson-detail-layout">
            <aside className="lesson-sidebar">
              <div className="detail-card">
                <div className="detail-card-heading">
                  <h3>الفيديوهات</h3>
                  <span>{selectedLesson.videos.length} فيديو متاح</span>
                </div>
                <div className="detail-video-list">
                  {selectedLesson.videos.map((video, index) => (
                    <button
                      key={video.id}
                      type="button"
                      className={`detail-video-item ${selectedVideo?.id === video.id ? 'active' : ''}`}
                      onClick={() => selectVideo(video)}
                    >
                      <span>{video.title}</span>
                      <strong>{index + 1}</strong>
                    </button>
                  ))}
                </div>
              </div>

              <div className="detail-card">
                <div className="detail-card-heading">
                  <h3>ملفات المحاضرة</h3>
                  <span>{selectedLesson.pdfs.length} ملف متاح</span>
                </div>
                <div className="detail-file-list">
                  {selectedLesson.pdfs.map((pdf, index) => (
                    <article className="detail-file-item" key={pdf.id}>
                      <div>
                        <strong>{pdf.title}</strong>
                        <span>{`${pdf.pages} صفحة`}</span>
                      </div>
                      <button className="button button-secondary" type="button">
                        فتح الملف
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            </aside>

            <div className="lesson-main-panel">
              {selectedVideo && (
                <article className="player-preview-card">
                  <div className="player-stage">
                    <div className="video-watermark is-visible" aria-hidden="true">
                      <span>{selectedTeacher.name}</span>
                      <span>{selectedSubject.label}</span>
                      <span>THANWYA</span>
                    </div>
                    <img src={selectedVideo.poster} alt={selectedVideo.title} loading="eager" />
                    <button className="player-stage-button" type="button">
                      <Play size={26} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="player-copy">
                    <h3>{selectedVideo.title}</h3>
                    <p>{selectedVideo.summary}</p>
                    <div className="player-meta-row">
                      <span>{selectedTeacher.name}</span>
                      <strong>{selectedVideo.duration}</strong>
                    </div>
                  </div>
                </article>
              )}

              <div className="detail-card">
                <div className="detail-card-heading">
                  <h3>امتحانات الحصة</h3>
                  <span>{selectedLesson.exams.length} اختبار</span>
                </div>
                <div className="detail-exam-grid">
                  {selectedLesson.exams.map((exam) => (
                    <article className="detail-exam-item" key={exam.id}>
                      <div>
                        <strong>{exam.title}</strong>
                        <span>{`${exam.questions} سؤال - ${exam.minutes} دقيقة`}</span>
                      </div>
                      <button className="button collection-button compact" type="button">
                        بدء الامتحان
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function StudentBreadcrumb({ viewState, selectedSubject, selectedTeacher, selectedLesson }) {
  return (
    <div className="student-breadcrumb">
      <span className={viewState.screen === 'subjects' ? 'active' : ''}>المواد</span>
      {selectedSubject && <span className={viewState.screen === 'teachers' ? 'active' : ''}>{selectedSubject.label}</span>}
      {selectedTeacher && <span className={viewState.screen === 'lessons' ? 'active' : ''}>{selectedTeacher.name}</span>}
      {selectedLesson && <span className={viewState.screen === 'lesson-detail' ? 'active' : ''}>{selectedLesson.title}</span>}
    </div>
  );
}

function SectionHeading({ eyebrow, title, description }) {
  return (
    <header className="catalog-heading">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function CatalogBackButton({ label, onClick }) {
  return (
    <button className="catalog-back" type="button" onClick={onClick}>
      <ArrowLeft size={18} aria-hidden="true" />
      {label}
    </button>
  );
}

function AudienceFields({ form, setForm }) {
  const selectedLevel = levelById(form.level);
  const selectedTrack = trackById(form.level, form.track);

  function updateLevel(levelId) {
    const track = defaultTrackFor(levelId);
    setForm((current) => ({
      ...current,
      level: levelId,
      track,
      major: defaultMajorFor(levelId, track),
    }));
  }

  function updateTrack(trackId) {
    setForm((current) => ({
      ...current,
      track: trackId,
      major: defaultMajorFor(current.level, trackId),
    }));
  }

  return (
    <>
      <label>
        السنة
        <select value={form.level} onChange={(event) => updateLevel(event.target.value)}>
          {LEVELS.map((level) => (
            <option key={level.id} value={level.id}>
              {level.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        الشعبة
        <select value={form.track} onChange={(event) => updateTrack(event.target.value)}>
          {selectedLevel.tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
            </option>
          ))}
        </select>
      </label>
      {selectedTrack.majors.length > 0 && (
        <label>
          التخصص
          <select
            value={form.major}
            onChange={(event) => setForm((current) => ({ ...current, major: event.target.value }))}
          >
            {selectedTrack.majors.map((major) => (
              <option key={major.id} value={major.id}>
                {major.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function HeaderBlock({ icon: Icon, title, text }) {
  return (
    <div className="header-block">
      <span className="header-icon">
        <Icon size={22} aria-hidden="true" />
      </span>
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}

function CopyButton({ value, compact = false }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      className={compact ? 'icon-button' : 'button button-secondary'}
      type="button"
      onClick={copyValue}
      title="نسخ الكود"
      aria-label="نسخ الكود"
    >
      <Copy size={compact ? 16 : 18} aria-hidden="true" />
      {!compact && (copied ? 'تم النسخ' : 'نسخ')}
    </button>
  );
}

function EmptyState({ title }) {
  return (
    <div className="empty-state">
      <LibraryBig size={28} aria-hidden="true" />
      <strong>{title}</strong>
    </div>
  );
}

function LibraryPanelTree({ library, setLibrary, lessonCodes, setLessonCodes }) {
  const [subjectId, setSubjectId] = useState(library[0]?.id ?? '');
  const [teacherId, setTeacherId] = useState('');
  const [folderPath, setFolderPath] = useState([]);
  const [teacherForm, setTeacherForm] = useState({ name: '', image: '', imageFile: null, imageFileName: '' });
  const [folderForm, setFolderForm] = useState({ title: '', subtitle: '', cover: '', coverFileName: '', coverFile: null });
  const [examDraft, setExamDraft] = useState({
    title: '',
    minutes: 20,
    questions: [createEmptyQuestion(0)],
  });
  const [resourceForm, setResourceForm] = useState({
    videoTitle: '',
    videoDuration: '',
    videoSourceType: 'url',
    videoUrl: '',
    videoFileName: '',
    videoFile: null,
    pdfTitle: '',
    pdfPages: '',
  });

  const selectedSubject = library.find((subject) => subject.id === subjectId) ?? library[0] ?? null;
  const selectedTeacher = selectedSubject?.teachers.find((teacher) => teacher.id === teacherId) ?? selectedSubject?.teachers[0] ?? null;
  const rootFolders = normalizeFolderList(selectedTeacher?.lessons ?? []);

  let currentFolders = rootFolders;
  let selectedFolder = null;
  for (const folderId of folderPath) {
    selectedFolder = currentFolders.find((folder) => folder.id === folderId) ?? null;
    currentFolders = selectedFolder?.children ?? [];
  }

  const folderTrail = [];
  let walker = rootFolders;
  for (const folderId of folderPath) {
    const folder = walker.find((item) => item.id === folderId);
    if (!folder) break;
    folderTrail.push(folder);
    walker = folder.children;
  }
  const selectedLessonCode = lessonCodes.find((code) => code.lessonId === selectedFolder?.id) ?? null;

  useEffect(() => {
    if (!selectedSubject && library[0]) setSubjectId(library[0].id);
    if (selectedSubject && !selectedSubject.teachers.find((teacher) => teacher.id === teacherId)) {
      setTeacherId(selectedSubject.teachers[0]?.id ?? '');
      setFolderPath([]);
    }
  }, [library, selectedSubject, teacherId]);

  useEffect(() => {
    setFolderPath((current) => {
      if (!selectedTeacher) return [];
      let level = normalizeFolderList(selectedTeacher.lessons);
      const nextPath = [];
      for (const folderId of current) {
        const folder = level.find((item) => item.id === folderId);
        if (!folder) break;
        nextPath.push(folder.id);
        level = folder.children;
      }
      return nextPath;
    });
  }, [selectedTeacher]);

  function updateSubject(subjectTargetId, updater) {
    setLibrary((items) => items.map((subject) => (subject.id === subjectTargetId ? updater(subject) : subject)));
  }

  function collectVideoAssetIdsFromFolders(folders) {
    const ids = [];
    for (const folder of folders ?? []) {
      for (const video of folder.videos ?? []) {
        if (video.sourceType === 'file' && video.assetId) ids.push(video.assetId);
      }
      ids.push(...collectVideoAssetIdsFromFolders(folder.children ?? []));
    }
    return ids;
  }

  function removeSubject(subjectTargetId) {
    const subject = library.find((item) => item.id === subjectTargetId);
    if (!subject) return;
    collectVideoAssetIdsFromFolders(subject.teachers.flatMap((teacher) => teacher.lessons ?? [])).forEach((assetId) => {
      deleteVideoAsset(assetId).catch((error) => {
        console.warn('Failed to delete subject video asset', error);
      });
    });
    setLibrary((items) => items.filter((item) => item.id !== subjectTargetId));
    if (subjectId === subjectTargetId) {
      const nextSubject = library.find((item) => item.id !== subjectTargetId) ?? null;
      setSubjectId(nextSubject?.id ?? '');
      setTeacherId('');
      setFolderPath([]);
    }
  }

  function updateTeacher(subjectTargetId, teacherTargetId, updater) {
    updateSubject(subjectTargetId, (subject) => ({
      ...subject,
      teachers: subject.teachers.map((teacher) => (teacher.id === teacherTargetId ? updater(teacher) : teacher)),
    }));
  }

  function commitTree(updater) {
    if (!selectedSubject || !selectedTeacher) return;
    updateTeacher(selectedSubject.id, selectedTeacher.id, (teacher) => ({
      ...teacher,
      lessons: normalizeFolderList(updater(normalizeFolderList(teacher.lessons))),
    }));
  }

  function submitTeacher(event) {
    event.preventDefault();
    if (!selectedSubject || !teacherForm.name.trim()) return;
    const teacherImage =
      teacherForm.imageFile ||
      teacherForm.image.trim() ||
      'https://api.dicebear.com/9.x/personas/svg?seed=' + encodeURIComponent(teacherForm.name.trim()) + '&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf';
    const teacher = {
      id: createId('teacher'),
      name: teacherForm.name.trim(),
      role: 'مدرس المادة',
      image: teacherImage,
      lessons: [],
    };
    updateSubject(selectedSubject.id, (subject) => ({ ...subject, teachers: [...subject.teachers, teacher] }));
    setTeacherId(teacher.id);
    setFolderPath([]);
    setTeacherForm({ name: '', image: '', imageFile: null, imageFileName: '' });
  }

  async function handleTeacherImageFile(file) {
    if (!file) return;
    const image = await readFileAsDataUrl(file);
    setTeacherForm((current) => ({
      ...current,
      image,
      imageFile: file,
      imageFileName: file.name,
    }));
  }

  function removeTeacher(teacherTargetId) {
    if (!selectedSubject) return;
    const teacher = selectedSubject.teachers.find((item) => item.id === teacherTargetId);
    if (teacher) {
      collectVideoAssetIdsFromFolders(teacher.lessons ?? []).forEach((assetId) => deleteVideoAsset(assetId).catch((error) => {
        console.warn('Failed to delete teacher video asset', error);
      }));
    }
    updateSubject(selectedSubject.id, (subject) => ({
      ...subject,
      teachers: subject.teachers.filter((teacher) => teacher.id !== teacherTargetId),
    }));
    setFolderPath([]);
  }

  async function submitFolder(event) {
    event.preventDefault();
    if (!selectedSubject || !selectedTeacher || !folderForm.title.trim()) return;
    let cover = folderForm.cover.trim();
    if (folderForm.coverFile) {
      cover = await readFileAsDataUrl(folderForm.coverFile);
    }
    const folder = {
      id: createId('folder'),
      title: folderForm.title.trim(),
      subtitle: folderForm.subtitle.trim() || 'محتوى جديد',
      cover: cover || `https://picsum.photos/seed/${Date.now()}/900/520`,
      videos: [],
      pdfs: [],
      exams: [],
      children: [],
    };

    commitTree((tree) => appendChildFolder(tree, selectedFolder?.id ?? '', folder));
    setFolderPath((current) => [...current, folder.id]);
    setFolderForm({ title: '', subtitle: '', cover: '', coverFileName: '', coverFile: null });
  }

  function removeFolder(folderId) {
    const folder = findFolderById(selectedTeacher?.lessons ?? [], folderId);
    if (folder) {
      collectVideoAssetIdsFromFolders([folder]).forEach((assetId) => deleteVideoAsset(assetId).catch((error) => {
        console.warn('Failed to delete folder video asset', error);
      }));
    }
    commitTree((tree) => removeFolderById(tree, folderId));
    setFolderPath((current) => current.filter((id) => id !== folderId));
  }

  function moveFolder(folderId, direction) {
    commitTree((tree) => moveFolderWithinParent(tree, folderId, direction, selectedFolder?.id ?? ''));
  }

  function openFolder(folder) {
    setFolderPath((current) => [...current, folder.id]);
  }

  function goToFolder(index) {
    if (index < 0) return setFolderPath([]);
    setFolderPath(folderTrail.slice(0, index + 1).map((item) => item.id));
  }

  async function addResource(type) {
    if (!selectedFolder) return;

    if (type === 'video' && resourceForm.videoTitle.trim()) {
      const isFile = resourceForm.videoSourceType === 'file' && resourceForm.videoFile;
      const videoAsset = isFile ? await saveVideoAsset(resourceForm.videoFile) : null;

      commitTree((tree) =>
        updateFolderById(tree, selectedFolder.id, (folder) => ({
          ...folder,
          videos: [
            ...folder.videos,
            {
              id: createId('video'),
              title: resourceForm.videoTitle.trim(),
              duration: resourceForm.videoDuration.trim() || '25 دقيقة',
              sourceType: isFile ? 'file' : 'url',
              source: isFile ? videoAsset?.url ?? '' : resourceForm.videoUrl.trim(),
              assetId: videoAsset?.id ?? '',
              fileName: videoAsset?.fileName ?? '',
              poster: folder.cover,
              summary: `شرح ${selectedSubject.name} مع ${selectedTeacher.name}.`,
            },
          ],
        })),
      );
      setResourceForm((current) => ({ ...current, videoTitle: '', videoDuration: '', videoUrl: '', videoFileName: '', videoFile: null }));
    }

    if (type === 'pdf' && resourceForm.pdfTitle.trim()) {
      commitTree((tree) =>
        updateFolderById(tree, selectedFolder.id, (folder) => ({
          ...folder,
          pdfs: [
            ...folder.pdfs,
            {
              id: createId('pdf'),
              title: resourceForm.pdfTitle.trim(),
              pages: Number(resourceForm.pdfPages) || 10,
              summary: 'ملف مضاف من لوحة الأدمن.',
            },
          ],
        })),
      );
      setResourceForm((current) => ({ ...current, pdfTitle: '', pdfPages: '' }));
    }

    if (type === 'exam' && examDraft.title.trim()) {
      commitTree((tree) =>
        updateFolderById(tree, selectedFolder.id, (folder) => ({
          ...folder,
          exams: [
            ...folder.exams,
            {
              id: createId('exam'),
              title: examDraft.title.trim(),
              questions: examDraft.questions.length,
              minutes: Number(examDraft.minutes) || 20,
              questionsData: normalizeQuestions(examDraft.questions),
            },
          ],
        })),
      );
      setExamDraft({ title: '', minutes: 20, questions: [createEmptyQuestion(0)] });
    }
  }

  function removeResource(type, resourceId) {
    if (!selectedFolder) return;
    if (type === 'videos') {
      const video = selectedFolder.videos.find((item) => item.id === resourceId);
      if (video?.assetId) deleteVideoAsset(video.assetId).catch((error) => {
        console.warn('Failed to delete lesson video asset', error);
      });
    }
    commitTree((tree) =>
      updateFolderById(tree, selectedFolder.id, (folder) => ({
        ...folder,
        [type]: folder[type].filter((item) => item.id !== resourceId),
      })),
    );
  }

  function handleVideoFile(file) {
    if (!file) return;
    setResourceForm((current) => ({
      ...current,
      videoSourceType: 'file',
      videoFileName: file.name,
      videoFile: file,
    }));
  }

  async function handleFolderCoverFile(file) {
    if (!file) return;
    const cover = await readFileAsDataUrl(file);
    setFolderForm((current) => ({
      ...current,
      cover,
      coverFileName: file.name,
      coverFile: file,
    }));
  }

  return (
    <div className="stack spacious">
      <HeaderBlock
        icon={FolderOpen}
        title="الفولدرات والمدرسين"
        text="أضف مدرسين وفولدرات داخل فولدرات ثم ارفع الفيديوهات والملفات والامتحانات بداخلها."
      />

      <section className="admin-library-shell">
        <aside className="admin-subjects-panel panel">
          <h3>المواد</h3>
          <div className="admin-subject-list">
            {library.map((subject) => (
              <button
                key={subject.id}
                type="button"
                className={`admin-subject-pill ${selectedSubject?.id === subject.id ? 'active' : ''}`}
                onClick={() => setSubjectId(subject.id)}
              >
                {subject.name}
              </button>
            ))}
          </div>
        </aside>

        <div className="admin-library-main">
          {selectedSubject && (
            <section className="panel library-panel-block">
              <div className="library-block-header">
                <div>
                  <span>مدرسين المادة</span>
                  <h3>{selectedSubject.name}</h3>
                </div>
              </div>

              <form className="form-grid" onSubmit={submitTeacher}>
                <label>
                  اسم المدرس
                  <input value={teacherForm.name} onChange={(e) => setTeacherForm((c) => ({ ...c, name: e.target.value }))} />
                </label>
                <label>
                  صورة المدرس
                  <input value={teacherForm.image} onChange={(e) => setTeacherForm((c) => ({ ...c, image: e.target.value, imageFile: null, imageFileName: '' }))} placeholder="https://..." />
                </label>
                <label>
                  أو ارفع صورة
                  <input type="file" accept="image/*" onChange={(e) => handleTeacherImageFile(e.target.files?.[0] ?? null)} />
                </label>
                <button className="button button-primary form-submit" type="submit">
                  <Plus size={18} aria-hidden="true" />
                  إضافة مدرس
                </button>
              </form>

              <div className="admin-teacher-grid">
                {selectedSubject.teachers.map((teacher) => (
                  <article className={`admin-teacher-card ${selectedTeacher?.id === teacher.id ? 'active' : ''}`} key={teacher.id}>
                    <button type="button" className="teacher-select-surface" onClick={() => { setTeacherId(teacher.id); setFolderPath([]); }}>
                      <img src={teacher.image} alt={teacher.name} loading="lazy" />
                      <div>
                        <strong>{teacher.name}</strong>
                        <span>{countNestedFolders(teacher.lessons)} فولدر</span>
                      </div>
                    </button>
                    <div className="row-actions">
                      <button className="icon-button danger" type="button" onClick={() => removeTeacher(teacher.id)} title="حذف المدرس" aria-label="حذف المدرس">
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {selectedTeacher && (
            <section className="panel library-panel-block">
              <div className="library-block-header">
                <div>
                  <span>{selectedFolder ? 'الفولدر الحالي' : 'فولدرات المدرس'}</span>
                  <h3>{selectedFolder ? selectedFolder.title : selectedTeacher.name}</h3>
                </div>
              </div>

              <div className="folder-crumbs">
                <button type="button" className={`folder-crumb ${folderPath.length === 0 ? 'active' : ''}`} onClick={() => goToFolder(-1)}>الجذر</button>
                {folderTrail.map((item, index) => (
                  <button key={item.id} type="button" className={`folder-crumb ${index === folderTrail.length - 1 ? 'active' : ''}`} onClick={() => goToFolder(index)}>
                    {item.title}
                  </button>
                ))}
              </div>

              <form className="form-grid" onSubmit={submitFolder}>
                <label>
                  اسم الفولدر
                  <input value={folderForm.title} onChange={(e) => setFolderForm((c) => ({ ...c, title: e.target.value }))} />
                </label>
                <label>
                  وصف قصير
                  <input value={folderForm.subtitle} onChange={(e) => setFolderForm((c) => ({ ...c, subtitle: e.target.value }))} />
                </label>
                <label>
                  صورة الغلاف
                  <input value={folderForm.cover} onChange={(e) => setFolderForm((c) => ({ ...c, cover: e.target.value, coverFile: null, coverFileName: '' }))} placeholder="https://..." />
                </label>
                <label>
                  أو ارفع صورة
                  <input type="file" accept="image/*" onChange={(e) => handleFolderCoverFile(e.target.files?.[0] ?? null)} />
                </label>
                <button className="button button-primary form-submit" type="submit">
                  <Plus size={18} aria-hidden="true" />
                  {selectedFolder ? 'إضافة فولدر داخلي' : 'إضافة فولدر'}
                </button>
              </form>
              {folderForm.coverFileName && <p className="muted">الصورة المختارة: {folderForm.coverFileName}</p>}

              <div className="admin-lesson-grid">
                {currentFolders.length > 0 ? currentFolders.map((folder) => {
                  const summary = folderResourceSummary(folder);
                  return (
                    <article className={`admin-lesson-card ${selectedFolder?.id === folder.id ? 'active' : ''}`} key={folder.id}>
                      <button type="button" className="lesson-select-surface" onClick={() => openFolder(folder)}>
                        <img src={folder.cover} alt={folder.title} loading="lazy" />
                        <div>
                          <strong>{folder.title}</strong>
                          <span>{folder.subtitle}</span>
                          <small>{`${summary.childFolders} فولدر - ${summary.videos} فيديو - ${summary.pdfs} PDF - ${summary.exams} امتحان`}</small>
                        </div>
                      </button>
                      <div className="row-actions">
                        <button className="icon-button" type="button" onClick={() => moveFolder(folder.id, -1)} aria-label="تحريك لأعلى">
                          <ArrowLeft size={17} aria-hidden="true" />
                        </button>
                        <button className="icon-button" type="button" onClick={() => moveFolder(folder.id, 1)} aria-label="تحريك لأسفل">
                          <ArrowLeft size={17} aria-hidden="true" style={{ transform: 'rotate(180deg)' }} />
                        </button>
                        <button className="icon-button danger" type="button" onClick={() => removeFolder(folder.id)} aria-label="حذف الفولدر">
                          <Trash2 size={17} aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  );
                }) : <EmptyState title="لا يوجد فولدرات" />}
              </div>
            </section>
          )}

          {selectedFolder && (
            <section className="panel library-panel-block">
              <div className="library-block-header">
                <div>
                  <span>محتوى الفولدر</span>
                  <h3>{selectedFolder.title}</h3>
                </div>
              </div>

              <div className="resource-admin-shell">
                <div className="resource-admin-section">
                  <h4>الفيديوهات</h4>
                  <div className="resource-admin-form">
                    <input value={resourceForm.videoTitle} onChange={(e) => setResourceForm((c) => ({ ...c, videoTitle: e.target.value }))} placeholder="اسم الفيديو" />
                    <input value={resourceForm.videoDuration} onChange={(e) => setResourceForm((c) => ({ ...c, videoDuration: e.target.value }))} placeholder="المدة" />
                    <select value={resourceForm.videoSourceType} onChange={(e) => setResourceForm((c) => ({ ...c, videoSourceType: e.target.value }))}>
                      <option value="url">رابط Stream</option>
                      <option value="file">ملف MP4</option>
                    </select>
                    {resourceForm.videoSourceType === 'url' ? (
                      <input value={resourceForm.videoUrl} onChange={(e) => setResourceForm((c) => ({ ...c, videoUrl: e.target.value }))} placeholder="https://..." />
                    ) : (
                      <input type="file" accept="video/mp4" onChange={(e) => handleVideoFile(e.target.files?.[0] ?? null)} />
                    )}
                    <button className="button button-primary" type="button" onClick={() => addResource('video')}>إضافة فيديو</button>
                  </div>
                  {resourceForm.videoSourceType === 'file' && resourceForm.videoFileName && (
                    <p className="muted">الملف المختار: {resourceForm.videoFileName}</p>
                  )}
                  <div className="table-list">
                    {selectedFolder.videos.map((video) => (
                      <article className="data-row" key={video.id}>
                        <div>
                          <strong>{video.title}</strong>
                          <span>{video.duration}</span>
                        </div>
                        <button className="icon-button danger" type="button" onClick={() => removeResource('videos', video.id)} aria-label="حذف الفيديو"><Trash2 size={17} aria-hidden="true" /></button>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="resource-admin-section">
                  <h4>ملفات PDF</h4>
                  <div className="resource-admin-form">
                    <input value={resourceForm.pdfTitle} onChange={(e) => setResourceForm((c) => ({ ...c, pdfTitle: e.target.value }))} placeholder="اسم الملف" />
                    <input value={resourceForm.pdfPages} onChange={(e) => setResourceForm((c) => ({ ...c, pdfPages: e.target.value }))} placeholder="عدد الصفحات" />
                    <button className="button button-primary" type="button" onClick={() => addResource('pdf')}>إضافة PDF</button>
                  </div>
                  <div className="table-list">
                    {selectedFolder.pdfs.map((pdf) => (
                      <article className="data-row" key={pdf.id}>
                        <div>
                          <strong>{pdf.title}</strong>
                          <span>{pdf.pages} صفحة</span>
                        </div>
                        <button className="icon-button danger" type="button" onClick={() => removeResource('pdfs', pdf.id)} aria-label="حذف الملف"><Trash2 size={17} aria-hidden="true" /></button>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="resource-admin-section">
                  <h4>الامتحانات</h4>
                  <div className="resource-admin-form triple">
                    <input value={examDraft.title} onChange={(e) => setExamDraft((c) => ({ ...c, title: e.target.value }))} placeholder="اسم الامتحان" />
                    <input value={examDraft.minutes} onChange={(e) => setExamDraft((c) => ({ ...c, minutes: e.target.value }))} placeholder="الدقائق" />
                    <button className="button button-primary" type="button" onClick={() => addResource('exam')}>إضافة امتحان</button>
                  </div>
                  <div className="stack spacious">
                    <div className="library-block-header">
                      <div>
                        <span>أسئلة الامتحان</span>
                        <h3>{examDraft.questions.length} سؤال</h3>
                      </div>
                      <button className="button button-secondary" type="button" onClick={() => setExamDraft((c) => ({ ...c, questions: [...c.questions, createEmptyQuestion(c.questions.length)] }))}>
                        <Plus size={18} aria-hidden="true" />
                        إضافة سؤال
                      </button>
                    </div>
                    {examDraft.questions.map((question, questionIndex) => (
                      <article className="question-builder-card" key={question.id}>
                        <div className="question-builder-head">
                          <strong>سؤال {questionIndex + 1}</strong>
                          <button
                            className="icon-button danger"
                            type="button"
                            onClick={() =>
                              setExamDraft((current) => ({
                                ...current,
                                questions: current.questions.length === 1
                                  ? current.questions
                                  : current.questions.filter((item) => item.id !== question.id),
                              }))
                            }
                            aria-label="حذف السؤال"
                          >
                            <Trash2 size={17} aria-hidden="true" />
                          </button>
                        </div>
                        <input
                          value={question.text}
                          onChange={(e) =>
                            setExamDraft((current) => ({
                              ...current,
                              questions: current.questions.map((item) => (item.id === question.id ? { ...item, text: e.target.value } : item)),
                            }))
                          }
                          placeholder="نص السؤال"
                        />
                        <div className="question-options-grid">
                          {question.options.map((option, optionIndex) => (
                            <label className="question-option-row" key={`${question.id}-${optionIndex}`}>
                              <input
                                value={option}
                                onChange={(e) =>
                                  setExamDraft((current) => ({
                                    ...current,
                                    questions: current.questions.map((item) =>
                                      item.id === question.id
                                        ? { ...item, options: item.options.map((value, idx) => (idx === optionIndex ? e.target.value : value)) }
                                        : item,
                                    ),
                                  }))
                                }
                                placeholder={`الاختيار ${optionIndex + 1}`}
                              />
                              <input
                                type="radio"
                                name={`folder-correct-${question.id}`}
                                checked={question.correctIndex === optionIndex}
                                onChange={() =>
                                  setExamDraft((current) => ({
                                    ...current,
                                    questions: current.questions.map((item) => (item.id === question.id ? { ...item, correctIndex: optionIndex } : item)),
                                  }))
                                }
                              />
                              <span>صحيحة</span>
                            </label>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="table-list">
                    {selectedFolder.exams.map((exam) => (
                      <article className="data-row" key={exam.id}>
                        <div>
                          <strong>{exam.title}</strong>
                          <span>{`${exam.questionsData?.length ?? exam.questions} سؤال - ${exam.minutes} دقيقة`}</span>
                        </div>
                        <button className="icon-button danger" type="button" onClick={() => removeResource('exams', exam.id)} aria-label="حذف الامتحان"><Trash2 size={17} aria-hidden="true" /></button>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function StudentDashboardTree({ profile, library, setLibrary, accessRecords = [], studentToken, homeSignal, onMainScreenChange }) {
  const level = levelById(profile.level);
  const track = trackById(profile.level, profile.track);
  const major = profile.major ? majorById(profile.level, profile.track, profile.major) : null;
  const studentLibrary = useMemo(() => filterLibraryForProfile(profile, library), [profile.level, profile.track, profile.major, library]);
  const [lessonAccess, setLessonAccess] = useState(() => accessRecords);
  const [viewState, setViewState] = useState({
    screen: 'subjects',
    subjectId: '',
    teacherId: '',
    folderPath: [],
    videoId: '',
    examId: '',
  });
  const [examAnswers, setExamAnswers] = useState({});
  const [examResult, setExamResult] = useState(null);
  const [lessonAccessInput, setLessonAccessInput] = useState('');
  const [lessonAccessError, setLessonAccessError] = useState('');
  const videoPlayerRef = useRef(null);
  const [resolvedVideoSource, setResolvedVideoSource] = useState('');

  const selectedSubject = studentLibrary.find((subject) => subject.id === viewState.subjectId) ?? null;
  const selectedTeacher = selectedSubject?.teachers.find((teacher) => teacher.id === viewState.teacherId) ?? null;
  const rootFolders = normalizeFolderList(selectedTeacher?.lessons ?? []);

  let currentFolders = rootFolders;
  let selectedFolder = null;
  for (const folderId of viewState.folderPath) {
    selectedFolder = currentFolders.find((folder) => folder.id === folderId) ?? null;
    currentFolders = selectedFolder?.children ?? [];
  }

  const folderTrail = [];
  let walker = rootFolders;
  for (const folderId of viewState.folderPath) {
    const folder = walker.find((item) => item.id === folderId);
    if (!folder) break;
    folderTrail.push(folder);
    walker = folder.children;
  }
  const selectedExam = selectedFolder?.exams.find((exam) => exam.id === viewState.examId) ?? null;
  const selectedVideo = selectedFolder?.videos.find((video) => video.id === viewState.videoId) ?? selectedFolder?.videos[0] ?? null;
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const isLessonUnlocked = selectedFolder ? lessonAccess.some((item) => item.lessonId === selectedFolder.id || item.folderId === selectedFolder.id) : false;

  useEffect(() => {
    setViewState({ screen: 'subjects', subjectId: '', teacherId: '', folderPath: [], videoId: '', examId: '' });
    setExamAnswers({});
    setExamResult(null);
  }, [profile.level, profile.track, profile.major, homeSignal]);

  useEffect(() => {
    onMainScreenChange(viewState.screen === 'subjects');
  }, [onMainScreenChange, viewState.screen]);

  useEffect(() => {
    setLessonAccess(accessRecords);
  }, [accessRecords]);

  useEffect(() => {
    if (!studentToken) return;
    fetchStudentAccess()
      .then((response) => {
        setLessonAccess(response.access ?? []);
      })
      .catch((error) => {
        console.warn('Failed to refresh student access', error);
      });
  }, [studentToken]);

  useEffect(() => {
    if (selectedVideo?.sourceType !== 'file' && (resolvedVideoSource || selectedVideo?.source) && videoPlayerRef.current) {
      videoPlayerRef.current.play?.().catch(() => {});
    }
  }, [selectedVideo?.id, selectedVideo?.source, selectedVideo?.sourceType, resolvedVideoSource]);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;

    async function resolveSource() {
      if (!selectedVideo) {
        setResolvedVideoSource('');
        return;
      }

      if (selectedVideo.sourceType === 'file' && selectedVideo.assetId) {
        try {
          const access = await requestVideoAccess(selectedVideo.assetId);
          if (!cancelled) setResolvedVideoSource(access.url);
          return;
        } catch {
          const asset = await loadVideoAsset(selectedVideo.assetId);
          if (!asset || cancelled) return;
          objectUrl = URL.createObjectURL(asset.blob);
          setResolvedVideoSource(objectUrl);
          return;
        }
      }

      setResolvedVideoSource(selectedVideo.source ?? '');
    }

    resolveSource().catch((error) => {
      console.warn('Failed to resolve remote video source', error);
      setResolvedVideoSource(selectedVideo?.source ?? '');
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedVideo?.id, selectedVideo?.source, selectedVideo?.sourceType, selectedVideo?.assetId, studentToken]);

  useEffect(() => {
    const video = videoPlayerRef.current;
    const source = resolvedVideoSource || selectedVideo?.source || '';
    if (!video || !source || !source.endsWith('.m3u8')) return undefined;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source;
      return undefined;
    }

    if (!Hls.isSupported()) return undefined;

    const hls = new Hls();
    hls.loadSource(source);
    hls.attachMedia(video);
    return () => {
      hls.destroy();
    };
  }, [selectedVideo?.id, selectedVideo?.source, resolvedVideoSource]);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;

    async function resolveSource() {
      if (!selectedVideo) {
        setResolvedVideoSource('');
        return;
      }

      if (selectedVideo.sourceType === 'file' && selectedVideo.assetId) {
        const asset = await loadVideoAsset(selectedVideo.assetId);
        if (!asset || cancelled) return;
        objectUrl = URL.createObjectURL(asset.blob);
        setResolvedVideoSource(objectUrl);
        return;
      }

      setResolvedVideoSource(selectedVideo.source ?? '');
    }

    resolveSource().catch((error) => {
      console.warn('Failed to resolve local video source', error);
      setResolvedVideoSource(selectedVideo?.source ?? '');
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedVideo?.id, selectedVideo?.sourceType, selectedVideo?.assetId, selectedVideo?.source]);

  useEffect(() => {
    setIsVideoPlaying(false);
  }, [selectedVideo?.id, resolvedVideoSource]);

  useEffect(() => {
    const nextState = { thanwyaStudent: true, viewState };

    if (!window.history.state?.thanwyaStudent) {
      window.history.replaceState(nextState, '', window.location.href);
    }
  }, []);

  useEffect(() => {
    const onPopState = (event) => {
      const nextViewState = event.state?.viewState;
      if (event.state?.thanwyaStudent && nextViewState) {
        setViewState(nextViewState);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(nextViewState) {
    window.history.pushState({ thanwyaStudent: true, viewState: nextViewState }, '', window.location.href);
    setViewState(nextViewState);
  }

  function openSubject(subject) {
    navigate({ screen: 'teachers', subjectId: subject.id, teacherId: '', folderPath: [], videoId: '', examId: '' });
    setExamAnswers({});
    setExamResult(null);
    setLessonAccessInput('');
    setLessonAccessError('');
  }

  function openTeacher(teacher) {
    navigate({ screen: 'folders', subjectId: selectedSubject?.id ?? '', teacherId: teacher.id, folderPath: [], videoId: '', examId: '' });
    setExamAnswers({});
    setExamResult(null);
    setLessonAccessInput('');
    setLessonAccessError('');
  }

  function openFolder(folder) {
    const nextPath = [...viewState.folderPath, folder.id];
    navigate({ ...viewState, screen: 'folder', folderPath: nextPath, videoId: '', examId: '' });
    setExamAnswers({});
    setExamResult(null);
    setLessonAccessInput('');
    setLessonAccessError('');
  }

  function selectVideo(video) {
    navigate({ ...viewState, videoId: video.id });
  }

  async function unlockLesson(folder, codeValue) {
    const entered = codeValue.trim();
    if (!folder || !entered) return;

    try {
      const response = await claimLessonCode(entered);
      if (response?.access) {
        setLessonAccess((current) => {
          const next = current.filter((item) => item.lessonId !== response.access.lessonId);
          return [response.access, ...next];
        });
      }
      setLessonAccessError('');
      setLessonAccessInput('');
    } catch (error) {
      setLessonAccessError(error instanceof Error ? error.message : 'تعذر فتح الحصة');
    }
  }

  function openExam(exam) {

    navigate({ ...viewState, screen: 'exam', examId: exam.id, videoId: '' });
    setExamAnswers({});
    setExamResult(null);
  }

  function updateExamAnswer(questionId, correctIndex) {
    setExamAnswers((current) => ({ ...current, [questionId]: correctIndex }));
  }

  function submitExamAnswers(exam) {
    setExamResult(gradeAnswers(exam, examAnswers));
  }

  function goBack() {
    window.history.back();
  }

  return (
    <main className="student-layout">
      <section className="student-hero">
        <div className="student-summary">
          <div>
            <span className="panel-kicker"><GraduationCap size={18} aria-hidden="true" /> صفحة الطالب</span>
            <h1>{profile.name}</h1>
            <p>{[level.name, track.id !== 'general' ? track.name : '', major?.name ?? ''].filter(Boolean).join(' / ')}</p>
          </div>
          <div className="student-code">
            <span>الكود</span>
            <strong>{profile.code}</strong>
          </div>
        </div>
      </section>

      <StudentBreadcrumb
        viewState={viewState}
        selectedSubject={selectedSubject}
        selectedTeacher={selectedTeacher}
        selectedLesson={selectedFolder}
      />

      {viewState.screen === 'subjects' && (
        <section className="catalog-screen">
          <SectionHeading eyebrow="المواد" title="اختر المادة" description="اختار المادة ثم المدرس ثم فولدر الحصة." />
          <div className="collection-grid subjects-mode">
            {studentLibrary.map((subject) => (
              <article className="collection-card subject-showcase-card" key={subject.id}>
                <div className="collection-cover"><img src={subject.cover} alt={subject.label} loading="lazy" /><span className="collection-year">{subject.year}</span></div>
                <div className="collection-content">
                  <h3>{subject.label}</h3>
                  <p>{subject.name}</p>
                  <div className="collection-meta"><span>عدد المعلمين:</span><strong>{subject.teachers.length} معلم</strong></div>
                  <button className="button collection-button" type="button" onClick={() => openSubject(subject)}>شوف المدرسين</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {viewState.screen === 'teachers' && selectedSubject && (
        <section className="catalog-screen">
          <CatalogBackButton label="رجوع للمواد" onClick={goBack} />
          <SectionHeading eyebrow={selectedSubject.label} title={`مدرسين مادة ${selectedSubject.label}`} description="اختار المدرس المناسب." />
          <div className="collection-grid teacher-mode">
            {selectedSubject.teachers.map((teacher) => (
              <article className="collection-card teacher-showcase-card" key={teacher.id}>
                <div className="collection-cover portrait"><img src={teacher.image} alt={teacher.name} loading="lazy" /><span className="collection-badge">مدرس</span></div>
                <div className="collection-content">
                  <h3>{teacher.name}</h3>
                  <p>{teacher.role}</p>
                  <div className="collection-meta"><span>عدد الفولدرات:</span><strong>{countNestedFolders(teacher.lessons)} فولدر</strong></div>
                  <button className="button collection-button" type="button" onClick={() => openTeacher(teacher)}>شوف الفولدرات</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {viewState.screen === 'folders' && selectedTeacher && (
        <section className="catalog-screen">
          <CatalogBackButton label="رجوع للمدرسين" onClick={goBack} />
          <SectionHeading eyebrow={selectedSubject?.label ?? ''} title={`فولدرات ${selectedTeacher.name}`} description="ادخل جوه أي فولدر لمشاهدة المحتوى." />
          <div className="collection-grid lesson-mode">
            {currentFolders.map((folder) => (
              <article className="collection-card lesson-showcase-card" key={folder.id}>
                <div className="lesson-mini-head"><span>{folder.title}</span></div>
                <div className="collection-content">
                  <p className="muted">{lessonAccess.some((item) => item.lessonId === folder.id || item.folderId === folder.id) ? 'مفتوحة على حسابك' : 'تحتاج كود الحصة'}</p>
                  <button className="button collection-button" type="button" onClick={() => openFolder(folder)}>فتح الفولدر</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {viewState.screen === 'folder' && selectedFolder && (
        <section className="catalog-screen detail-mode">
          <CatalogBackButton label="رجوع" onClick={goBack} />
          <SectionHeading eyebrow={selectedSubject?.label ?? ''} title={selectedFolder.title} description={isLessonUnlocked ? selectedFolder.subtitle : 'الحصة مقفولة بكود من الأدمن'} />
          {!isLessonUnlocked ? (
            <div className="panel lesson-lock-panel">
              <strong>{selectedFolder.title}</strong>
              <p className="muted">ادخل كود الحصة لفتح المحتوى.</p>
              <div className="lesson-lock-form">
                <input value={lessonAccessInput} onChange={(event) => setLessonAccessInput(event.target.value)} placeholder="كود الحصة" />
                <button className="button button-primary" type="button" onClick={() => unlockLesson(selectedFolder, lessonAccessInput)}>
                  فتح الحصة
                </button>
              </div>
              {lessonAccessError && <p className="error-text">{lessonAccessError}</p>}
              <p className="muted">بعد أول استخدام، الحصة بتفضل مفتوحة على الحساب ده.</p>
            </div>
          ) : (
            <div className="lesson-detail-layout">
              <aside className="lesson-sidebar">
                <div className="detail-card">
                  <div className="detail-card-heading"><h3>الفولدرات الداخلية</h3><span>{selectedFolder.children.length} فولدر</span></div>
                  <div className="detail-video-list">
                    {selectedFolder.children.map((folder) => (
                      <button key={folder.id} type="button" className="detail-video-item" onClick={() => openFolder(folder)}>
                        <span>{folder.title}</span>
                        <strong>{folder.children.length}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>
              <div className="lesson-main-panel">
                <article className="player-preview-card">
                  <div className="player-stage">
                    {resolvedVideoSource || selectedVideo?.source ? (
                      <>
                        <div className={`video-watermark ${isVideoPlaying ? 'is-visible' : ''}`} aria-hidden="true">
                          <span>{profile.name}</span>
                          <span>{profile.code}</span>
                          <span>THANWYA</span>
                        </div>
                        <video
                          key={selectedVideo.id}
                          ref={videoPlayerRef}
                          controls
                          autoPlay
                          playsInline
                          src={resolvedVideoSource || selectedVideo.source}
                          poster={selectedVideo.poster}
                          onPlay={() => setIsVideoPlaying(true)}
                          onPause={() => setIsVideoPlaying(false)}
                          onEnded={() => setIsVideoPlaying(false)}
                        />
                      </>
                    ) : (
                      <img src={selectedFolder.cover} alt={selectedFolder.title} loading="eager" />
                    )}
                  </div>
                  <div className="player-copy">
                    <h3>{selectedVideo?.title ?? selectedFolder.title}</h3>
                    <p>{selectedVideo?.summary ?? selectedFolder.subtitle}</p>
                    {!resolvedVideoSource && !selectedVideo?.source && <span className="muted">الفيديو ده ملوش مصدر تشغيل بعد.</span>}
                  </div>
                </article>
                <div className="detail-card">
                  <div className="detail-card-heading"><h3>الفيديوهات</h3><span>{selectedFolder.videos.length} فيديو</span></div>
                  <div className="detail-exam-grid">
                    {selectedFolder.videos.map((video) => (
                      <article className="detail-exam-item" key={video.id}>
                        <div><strong>{video.title}</strong><span>{video.duration}</span></div>
                        <button className="button collection-button compact" type="button" onClick={() => selectVideo(video)}>اختيار</button>
                      </article>
                    ))}
                  </div>
                </div>
                <div className="detail-card">
                  <div className="detail-card-heading"><h3>الامتحانات</h3><span>{selectedFolder.exams.length} امتحان</span></div>
                  <div className="detail-exam-grid">
                    {selectedFolder.exams.map((exam) => (
                      <article className="detail-exam-item" key={exam.id}>
                        <div>
                          <strong>{exam.title}</strong>
                          <span>{`${exam.questionsData?.length ?? exam.questions} سؤال - ${exam.minutes} دقيقة`}</span>
                        </div>
                        <button className="button collection-button compact" type="button" onClick={() => openExam(exam)}>
                          بدء الامتحان
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {viewState.screen === 'exam' && selectedExam && (
        <section className="catalog-screen detail-mode">
          <CatalogBackButton label="رجوع للفولدر" onClick={goBack} />
          <SectionHeading eyebrow={selectedSubject?.label ?? ''} title={selectedExam.title} description={`${selectedExam.minutes} دقيقة`} />
          <div className="lesson-detail-layout">
            <aside className="lesson-sidebar">
              <div className="detail-card">
                <div className="detail-card-heading"><h3>التعليمات</h3><span>{selectedExam.questionsData?.length ?? 0} سؤال</span></div>
                <p className="muted">اختار الإجابة الصحيحة ثم اضغط تصحيح.</p>
              </div>
            </aside>
            <div className="lesson-main-panel">
              <div className="stack spacious">
                {(selectedExam.questionsData ?? []).map((question, index) => (
                  <article className="question-runner-card" key={question.id}>
                    <strong>{index + 1}. {question.text}</strong>
                    <div className="question-runner-options">
                      {question.options.map((option, optionIndex) => (
                        <button
                          key={`${question.id}-${optionIndex}`}
                          type="button"
                          className={`question-runner-option ${examAnswers[question.id] === optionIndex ? 'active' : ''}`}
                          onClick={() => updateExamAnswer(question.id, optionIndex)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
                <button className="button button-primary" type="button" onClick={() => submitExamAnswers(selectedExam)}>
                  تصحيح تلقائي
                </button>
                {examResult && (
                  <div className="exam-result-card">
                    <strong>{examResult.correctCount} / {examResult.total}</strong>
                    <span>{examResult.percentage}%</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
