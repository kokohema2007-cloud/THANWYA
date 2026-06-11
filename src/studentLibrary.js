import { subjectsForProfile } from './data.js';
import { buildGeneratedQuestions } from './examTools.js';
import { localTeacherImageFor, teacherImageAssetIdFor } from './teacherImages.js';

const SUBJECT_CATALOG = [
  {
    name: 'عربي',
    label: 'Arabic',
    cover: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1200&q=80',
    teachers: ['Reda al farouk', 'Mohamed salah'],
  },
  {
    name: 'انجليزي',
    label: 'English',
    cover: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1200&q=80',
    teachers: ['Abdlhamed hamed', 'Englshawy', 'Mrs mai', '3abkry lo8a', 'Shreef almasry'],
  },
  {
    name: 'كيمياء',
    label: 'Chemistry',
    cover: 'https://images.unsplash.com/photo-1532187643603-ba119ca4109e?auto=format&fit=crop&w=1200&q=80',
    teachers: ['Kaled sakr', 'Abdlgwad', 'Joseph adel', 'Ashraf ElShenawy', 'Naser albatal'],
  },
  {
    name: 'فيزياء',
    label: 'Physics',
    cover: 'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?auto=format&fit=crop&w=1200&q=80',
    teachers: ['Abdlma3bod', 'Kerolos', 'Mahmoud magdy', 'mohamed adel', 'omar raia', 'tamer alkady'],
  },
  {
    name: 'احياء',
    label: 'Biology',
    cover: 'https://images.unsplash.com/photo-1530026405186-ed1f139313f8?auto=format&fit=crop&w=1200&q=80',
    teachers: ['Mohamed aymen', 'Ahmed rdwan', 'Algohary', 'Daif'],
  },
  {
    name: 'جيولوجيا',
    label: 'Geology',
    cover: 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1200&q=80',
    teachers: ['Algohary'],
  },
  {
    name: 'رياضيات',
    label: 'Maths',
    cover: 'https://images.unsplash.com/photo-1509228627152-72ae9ae6848d?auto=format&fit=crop&w=1200&q=80',
    teachers: ['Sherbeni', 'kelany', 'Ahmed 3sam', 'lotfy zhran'],
  },
  {
    name: 'جغرافيا',
    label: 'Geography',
    cover: 'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=1200&q=80',
    teachers: ['Gom3a alsyd', 'Ahmed zhran'],
  },
  {
    name: 'تاريخ',
    label: 'History',
    cover: 'https://images.unsplash.com/photo-1461360228754-6e81c478b882?auto=format&fit=crop&w=1200&q=80',
    teachers: ['Ahmed adel almoar5', 'Al5dawy ebrahim'],
  },
  {
    name: 'احصاء',
    label: 'Statistics',
    cover: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80',
    teachers: ['3abd almo3z'],
  },
];

const LESSON_NAMES = [
  'الفولدر الأول',
  'الفولدر الثاني',
  'الفولدر الثالث',
  'الفولدر الرابع',
];

const LESSON_THEMES = [
  'مقدمة وتأسيس',
  'شرح مركز',
  'حل أفكار مهمة',
  'مراجعة وختام',
];

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function portraitForTeacher(subject, teacherName) {
  const seed = encodeURIComponent(`${subject}-${teacherName}`);
  return `https://api.dicebear.com/9.x/personas/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

function lessonPoster(subject, teacherName, lessonIndex) {
  const seed = encodeURIComponent(`${subject}-${teacherName}-${lessonIndex}`);
  return `https://picsum.photos/seed/${seed}/900/520`;
}

function createVideoItems(subject, teacherName, lessonIndex) {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `${slugify(subject)}-${slugify(teacherName)}-lesson-${lessonIndex}-video-${index + 1}`,
    title: `${LESSON_THEMES[lessonIndex - 1]} - فيديو ${index + 1}`,
    duration: `${18 + lessonIndex * 4 + index * 3} دقيقة`,
    poster: lessonPoster(subject, `${teacherName}-video-${index + 1}`, lessonIndex),
    summary: `شرح ${subject} مع ${teacherName} بشكل مرتب ومركز.`,
  }));
}

function createPdfItems(subject, lessonIndex) {
  return [
    {
      id: `${slugify(subject)}-lesson-${lessonIndex}-pdf-1`,
      title: `ملف ${subject} - ${LESSON_NAMES[lessonIndex - 1]}`,
      pages: 8 + lessonIndex * 3,
      summary: 'ملخص منظم وأسئلة سريعة للمراجعة.',
    },
  ];
}

function createExamItems(subject, lessonIndex) {
  const exam = {
    id: `${slugify(subject)}-lesson-${lessonIndex}-exam-1`,
    title: `امتحان ${subject} - ${LESSON_NAMES[lessonIndex - 1]}`,
    questions: 10 + lessonIndex * 5,
    minutes: 20 + lessonIndex * 5,
  };
  return [{ ...exam, questionsData: buildGeneratedQuestions(exam) }];
}

function createLessons(subject, teacherName) {
  return LESSON_NAMES.map((lessonName, index) => {
    const lessonIndex = index + 1;
    return {
      id: `${slugify(subject)}-${slugify(teacherName)}-lesson-${lessonIndex}`,
      number: lessonIndex,
      title: lessonName,
      subtitle: LESSON_THEMES[index],
      cover: lessonPoster(subject, teacherName, lessonIndex),
      videos: createVideoItems(subject, teacherName, lessonIndex),
      pdfs: createPdfItems(subject, lessonIndex),
      exams: createExamItems(subject, lessonIndex),
      children: [],
    };
  });
}

function createTeacher(subject, teacherName) {
  const imageAssetId = teacherImageAssetIdFor(teacherName);
  return {
    id: `${slugify(subject)}-${slugify(teacherName)}`,
    name: teacherName,
    role: 'مدرس المادة',
    imageAssetId,
    image: localTeacherImageFor(teacherName) ?? portraitForTeacher(subject, teacherName),
    lessons: createLessons(subject, teacherName),
  };
}

export function createSeedLibrary() {
  return SUBJECT_CATALOG.map((subject) => ({
    id: `subject-${slugify(subject.name)}`,
    name: subject.name,
    label: subject.label,
    cover: subject.cover,
    year: '2026',
    teachers: subject.teachers.map((teacherName) => createTeacher(subject.name, teacherName)),
  }));
}

export function filterLibraryForProfile(profile, library) {
  const allowedSubjects = subjectsForProfile(profile);
  return allowedSubjects
    .map((subjectName) => library.find((subject) => subject.name === subjectName))
    .filter(Boolean);
}
