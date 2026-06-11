function repairMojibake(value) {
  if (typeof value !== 'string' || !/[ØÙÃÂð\u00bf]/.test(value)) return value;
  try {
    return new TextDecoder('utf-8').decode(Uint8Array.from(value, (character) => character.charCodeAt(0)));
  } catch {
    return value;
  }
}

function deepRepair(value) {
  if (Array.isArray(value)) return value.map((item) => deepRepair(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepRepair(item)]));
  }
  if (typeof value === 'string') return repairMojibake(value);
  return value;
}

const RAW_LEVELS = [
  {
    id: 'prep-2',
    name: 'تانية إعدادي',
    stage: 'الإعدادية',
    tracks: [{ id: 'general', name: 'عام', majors: [] }],
  },
  {
    id: 'prep-3',
    name: 'تالتة إعدادي',
    stage: 'الإعدادية',
    tracks: [{ id: 'general', name: 'عام', majors: [] }],
  },
  {
    id: 'secondary-1',
    name: 'أولى ثانوي',
    stage: 'الثانوية',
    tracks: [{ id: 'general', name: 'عام', majors: [] }],
  },
  {
    id: 'secondary-2',
    name: 'تانية ثانوي',
    stage: 'الثانوية',
    tracks: [
      { id: 'science', name: 'علمي', majors: [] },
      { id: 'literary', name: 'أدبي', majors: [] },
    ],
  },
  {
    id: 'secondary-3',
    name: 'تالتة ثانوي',
    stage: 'الثانوية العامة',
    tracks: [
      {
        id: 'science',
        name: 'علمي',
        majors: [
          { id: 'math', name: 'رياضة' },
          { id: 'bio', name: 'علوم' },
        ],
      },
      { id: 'literary', name: 'أدبي', majors: [] },
    ],
  },
];

const RAW_TYPE_LABELS = {
  video: 'فيديو',
  pdf: 'PDF',
  exam: 'امتحان',
};

const RAW_SEED_CODES = [];

const RAW_SEED_CONTENT = [
  {
    id: 'vid-derivatives-intro',
    type: 'video',
    title: 'مقدمة التفاضل وتطبيقاته',
    subject: 'رياضيات',
    level: 'secondary-3',
    track: 'science',
    major: 'math',
    meta: '42 دقيقة',
    secure: true,
    status: 'published',
    url: 'private://streams/thanwya/derivatives-intro/master.m3u8',
    description: 'شرح مركز للدرس الأول مع أمثلة محلولة.',
    createdAt: '2026-06-09T09:00:00.000Z',
  },
  {
    id: 'pdf-chem-summary',
    type: 'pdf',
    title: 'ملخص الباب الأول في الكيمياء',
    subject: 'كيمياء',
    level: 'secondary-3',
    track: 'science',
    major: 'bio',
    meta: '18 صفحة',
    secure: false,
    status: 'published',
    url: 'private://docs/thanwya/chemistry-chapter-1.pdf',
    description: 'ملخص سريع للمراجعة قبل حل الواجب.',
    createdAt: '2026-06-09T09:15:00.000Z',
  },
  {
    id: 'vid-arabic-review',
    type: 'video',
    title: 'مراجعة نحو شاملة',
    subject: 'لغة عربية',
    level: 'secondary-3',
    track: 'literary',
    major: '',
    meta: '55 دقيقة',
    secure: true,
    status: 'published',
    url: 'private://streams/thanwya/arabic-grammar/master.m3u8',
    description: 'مراجعة على أهم أفكار النحو للثانوية العامة.',
    createdAt: '2026-06-09T09:30:00.000Z',
  },
  {
    id: 'pdf-prep-science',
    type: 'pdf',
    title: 'قوانين الحركة للصف الثالث الإعدادي',
    subject: 'علوم',
    level: 'prep-3',
    track: 'general',
    major: '',
    meta: '12 صفحة',
    secure: false,
    status: 'published',
    url: 'private://docs/thanwya/prep-motion-laws.pdf',
    description: 'ورقة قوانين وتمارين قصيرة.',
    createdAt: '2026-06-09T09:45:00.000Z',
  },
];

const RAW_SEED_EXAMS = [
  {
    id: 'exam-calc-1',
    title: 'اختبار سريع على التفاضل',
    subject: 'رياضيات',
    level: 'secondary-3',
    track: 'science',
    major: 'math',
    questions: 20,
    minutes: 35,
    status: 'open',
    createdAt: '2026-06-09T11:00:00.000Z',
  },
  {
    id: 'exam-prep-science-1',
    title: 'اختبار علوم - الحركة',
    subject: 'علوم',
    level: 'prep-3',
    track: 'general',
    major: '',
    questions: 12,
    minutes: 20,
    status: 'open',
    createdAt: '2026-06-09T11:10:00.000Z',
  },
];

const SUBJECT_PRESETS = {
  'secondary-1': ['عربي', 'انجليزي', 'كيمياء', 'فيزياء', 'احياء', 'رياضيات', 'جغرافيا', 'تاريخ', 'احصاء'],
  'secondary-2:science': ['عربي', 'انجليزي', 'كيمياء', 'فيزياء', 'احياء', 'رياضيات'],
  'secondary-2:literary': ['عربي', 'انجليزي', 'جغرافيا', 'تاريخ', 'احصاء'],
  'secondary-3:science:bio': ['عربي', 'كيمياء', 'فيزياء', 'انجليزي', 'احياء', 'جيولوجيا'],
  'secondary-3:science:math': ['عربي', 'كيمياء', 'فيزياء', 'انجليزي', 'رياضيات'],
  'secondary-3:literary': ['عربي', 'انجليزي', 'جغرافيا', 'تاريخ', 'احصاء'],
};

const RAW_TEACHER_DIRECTORY = {
  english: {
    label: 'English',
    accent: '🇬🇧✨',
    teachers: ['Abdlhamed hamed', 'Englshawy', 'Mrs mai', '3abkry lo8a', 'Shreef almasry'],
  },
  arabic: {
    label: 'Arabic',
    accent: '🇪🇬✨',
    teachers: ['Reda al farouk', 'Mohamed salah'],
  },
  chemistry: {
    label: 'Chemistry',
    accent: '🧪✨',
    teachers: ['Kaled sakr', 'Abdlgwad', 'Joseph adel', 'Naser albatal'],
  },
  biology: {
    label: 'Biology',
    accent: '🦠✨',
    teachers: ['Mohamed aymen', 'Ahmed rdwan', 'Algohary', 'Daif'],
  },
  geology: {
    label: 'Geology',
    accent: '🌍✨',
    teachers: ['Algohary'],
  },
  physics: {
    label: 'Physics',
    accent: '⚛️✨',
    teachers: ['Abdlma3bod', 'Kerolos', 'Mahmoud magdy', 'mohamed adel', 'omar raia', 'tamer alkady'],
  },
  french: {
    label: 'French',
    accent: '🇫🇷✨',
    teachers: ['Hassan algblawy'],
  },
  maths: {
    label: 'Maths',
    accent: '➗✨',
    teachers: ['Sherbeni', 'kelany', 'Ahmed 3sam', 'lotfy zhran'],
  },
  history: {
    label: 'History',
    accent: '📜✨',
    teachers: ['Ahmed adel almoar5', 'Al5dawy ebrahim'],
  },
  geography: {
    label: 'Geography',
    accent: '🗺️✨',
    teachers: ['Gom3a alsyd', 'Ahmed zhran'],
  },
  deutsch: {
    label: 'Deutsch',
    accent: '🇩🇪✨',
    teachers: ['3abd almo3z'],
  },
  statistics: {
    label: 'Statistics',
    accent: '📊✨',
    teachers: [],
  },
};

export const LEVELS = deepRepair(RAW_LEVELS);
export const TYPE_LABELS = deepRepair(RAW_TYPE_LABELS);
export const SEED_CODES = deepRepair(RAW_SEED_CODES);
export const SEED_CONTENT = deepRepair(RAW_SEED_CONTENT);
export const SEED_EXAMS = deepRepair(RAW_SEED_EXAMS);
export const TEACHER_DIRECTORY = deepRepair(RAW_TEACHER_DIRECTORY);

const SUBJECT_TO_TEACHER_KEY = {
  عربي: 'arabic',
  انجليزي: 'english',
  كيمياء: 'chemistry',
  فيزياء: 'physics',
  احياء: 'biology',
  رياضيات: 'maths',
  جغرافيا: 'geography',
  تاريخ: 'history',
  احصاء: 'statistics',
  جيولوجيا: 'geology',
  فرنسي: 'french',
  الماني: 'deutsch',
};

export function levelById(levelId) {
  return LEVELS.find((level) => level.id === levelId) ?? LEVELS[0];
}

export function trackById(levelId, trackId) {
  const level = levelById(levelId);
  return level.tracks.find((track) => track.id === trackId) ?? level.tracks[0];
}

export function majorById(levelId, trackId, majorId) {
  const track = trackById(levelId, trackId);
  return track.majors.find((major) => major.id === majorId) ?? null;
}

export function defaultTrackFor(levelId) {
  return levelById(levelId).tracks[0].id;
}

export function defaultMajorFor(levelId, trackId) {
  const track = trackById(levelId, trackId);
  return track.majors[0]?.id ?? '';
}

export function audienceLabel(item) {
  const level = levelById(item.level);
  const track = trackById(item.level, item.track || 'general');
  const major = item.major ? majorById(item.level, item.track, item.major) : null;
  return [level.name, track.id !== 'general' ? track.name : '', major?.name ?? '']
    .filter(Boolean)
    .join(' / ');
}

export function matchesAudience(item, profile) {
  if (!profile || item.level !== profile.level) return false;
  if (item.track && item.track !== 'general' && item.track !== profile.track) return false;
  if (item.major && item.major !== profile.major) return false;
  return item.status === 'published' || item.status === 'open';
}

export function subjectsForProfile(profile) {
  if (!profile) return [];

  if (profile.level === 'secondary-1') {
    return SUBJECT_PRESETS['secondary-1'];
  }

  if (profile.level === 'secondary-2') {
    return SUBJECT_PRESETS[`secondary-2:${profile.track}`] ?? SUBJECT_PRESETS['secondary-2:science'];
  }

  if (profile.level === 'secondary-3' && profile.track === 'science' && profile.major) {
    return SUBJECT_PRESETS[`secondary-3:science:${profile.major}`] ?? [];
  }

  if (profile.level === 'secondary-3') {
    return SUBJECT_PRESETS[`secondary-3:${profile.track}`] ?? [];
  }

  return [];
}

export function teacherGroupsForSubjects(subjects) {
  return subjects
    .map((subject) => {
      const key = SUBJECT_TO_TEACHER_KEY[subject];
      const directory = key ? TEACHER_DIRECTORY[key] : null;
      return {
        subject,
        label: directory?.label ?? subject,
        accent: directory?.accent ?? '📘',
        teachers: directory?.teachers ?? [],
      };
    })
    .filter((entry) => entry.teachers.length > 0);
}
