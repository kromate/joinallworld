/**
 * UNILAG compressed-degree curriculum for Allworld.
 *
 * The programme and course names are game content, not an academic transcript or a claim that
 * these are current University of Lagos course codes. Computer Engineering sits under the
 * Electrical and Electronics Engineering department in the 2025 source material supplied for
 * this feature. Every duration, fee, score weight and compressed-semester rule is an original
 * beta gameplay value and is collected in UNILAG_BETA_RULES below.
 */

/** @typedef {'morning'|'afternoon'|'night'} LectureSlotId */
/** @typedef {{id:string,open:number,close:number,label:string}} LectureSlot */
/** @typedef {{id:string,title:string,credits:number,skill:string,slot:LectureSlotId}} Course */
/** @typedef {{number:number,courses:ReadonlyArray<Course>}} Semester */
/** @typedef {{id:string,label:string,faculty:string,department:string,spot:string,skill:string,careerTrack:string|null,note?:string,semesters:ReadonlyArray<Semester>}} Programme */

/** @type {Readonly<Record<LectureSlotId, LectureSlot>>} */
export const LECTURE_SLOTS = Object.freeze({
  morning: Object.freeze({ id: 'morning', open: 9 * 60, close: 11 * 60, label: '9:00 AM to 11:00 AM' }),
  afternoon: Object.freeze({ id: 'afternoon', open: 14 * 60, close: 16 * 60, label: '2:00 PM to 4:00 PM' }),
  night: Object.freeze({ id: 'night', open: 20 * 60, close: 22 * 60, label: '8:00 PM to 10:00 PM' }),
});

/** @type {Readonly<Record<string, number>>} */
export const UNILAG_BETA_RULES = Object.freeze({
  admissionFee: 200,
  tuition: 1000,
  levy: 100,
  hostelFee: 300,
  hostelSleepSeconds: 60,
  hostelSleepEnergy: 20,
  semesterDays: 7,
  lectureSeconds: 30,
  assessmentSeconds: 45,
  campusJobSeconds: 60,
  lectureXp: 5,
  attendanceMaximumDays: 7,
  attendanceWeight: 20,
  assignmentWeight: 30,
  examWeight: 50,
  graduationCgpa: 2,
  scholarshipCgpa: 4,
  scholarshipAward: 200,
});

/** @param {string} id @param {string} title @param {number} credits @param {string} skill @param {LectureSlotId} slot @returns {Readonly<Course>} */
const course = (id, title, credits, skill, slot) => Object.freeze({ id, title, credits, skill, slot });
/** @param {number} number @param {Course[]} courses @returns {Readonly<Semester>} */
const semester = (number, courses) => Object.freeze({ number, courses: Object.freeze(courses) });
/** @param {{id:string,label:string,faculty:string,department:string,spot:string,skill:string,careerTrack:string|null,note?:string,semesters:Semester[]}} input @returns {Readonly<Programme>} */
const programme = ({ id, label, faculty, department, spot, skill, careerTrack, note, semesters }) => Object.freeze({
  id, label, faculty, department, spot, skill, careerTrack, ...(note ? { note } : {}),
  semesters: Object.freeze(semesters),
});

/** @type {Readonly<Record<string, Programme>>} */
export const PROGRAMMES = Object.freeze({
  eee: programme({
    id: 'eee', label: 'Electrical and Electronics Engineering', faculty: 'Engineering', department: 'Electrical and Electronics Engineering',
    spot: 'engineering', skill: 'coding', careerTrack: 'tech',
    semesters: [
      semester(1, [course('eee-101', 'Circuit Theory', 3, 'coding', 'morning'), course('eee-103', 'Digital Logic', 3, 'coding', 'afternoon'), course('mth-101-eee', 'Engineering Mathematics I', 3, 'coding', 'morning'), course('phy-101-eee', 'Applied Physics', 2, 'fitness', 'afternoon')]),
      semester(2, [course('eee-102', 'Signals and Systems', 3, 'coding', 'morning'), course('eee-104', 'Electronic Devices', 3, 'coding', 'afternoon'), course('eee-106', 'Electrical Machines', 3, 'coding', 'morning'), course('mth-102-eee', 'Engineering Mathematics II', 3, 'coding', 'afternoon')]),
    ],
  }),
  computer: programme({
    id: 'computer', label: 'Computer Engineering', faculty: 'Engineering', department: 'Electrical and Electronics Engineering',
    spot: 'engineering', skill: 'coding', careerTrack: 'tech',
    note: 'Computer Engineering is represented under Electrical and Electronics Engineering, following the verified 2025 department structure.',
    semesters: [
      semester(1, [course('cpe-101', 'Computer Engineering Foundations', 3, 'coding', 'morning'), course('cpe-103', 'Digital Systems', 3, 'coding', 'afternoon'), course('mth-101-cpe', 'Engineering Mathematics I', 3, 'coding', 'morning'), course('phy-101-cpe', 'Applied Physics', 2, 'fitness', 'afternoon')]),
      semester(2, [course('cpe-102', 'Programming for Engineers', 3, 'coding', 'morning'), course('cpe-104', 'Computer Architecture', 3, 'coding', 'afternoon'), course('cpe-106', 'Embedded Systems', 3, 'coding', 'morning'), course('mth-102-cpe', 'Engineering Mathematics II', 3, 'coding', 'afternoon')]),
    ],
  }),
  mechanical: programme({
    id: 'mechanical', label: 'Mechanical Engineering', faculty: 'Engineering', department: 'Mechanical Engineering',
    spot: 'engineering', skill: 'coding', careerTrack: null,
    semesters: [
      semester(1, [course('mec-101', 'Engineering Mechanics', 3, 'fitness', 'morning'), course('mec-103', 'Technical Drawing', 2, 'coding', 'afternoon'), course('mth-101-mec', 'Engineering Mathematics I', 3, 'coding', 'morning'), course('phy-101-mec', 'Applied Physics', 2, 'fitness', 'afternoon')]),
      semester(2, [course('mec-102', 'Thermodynamics', 3, 'fitness', 'morning'), course('mec-104', 'Materials Science', 3, 'fitness', 'afternoon'), course('mec-106', 'Manufacturing Practice', 3, 'hustle', 'morning'), course('mth-102-mec', 'Engineering Mathematics II', 3, 'coding', 'afternoon')]),
    ],
  }),
  civil: programme({
    id: 'civil', label: 'Civil Engineering', faculty: 'Engineering', department: 'Civil and Environmental Engineering',
    spot: 'engineering', skill: 'coding', careerTrack: null,
    semesters: [
      semester(1, [course('cve-101', 'Statics and Structures', 3, 'fitness', 'morning'), course('cve-103', 'Engineering Surveying', 3, 'coding', 'afternoon'), course('mth-101-cve', 'Engineering Mathematics I', 3, 'coding', 'morning'), course('phy-101-cve', 'Applied Physics', 2, 'fitness', 'afternoon')]),
      semester(2, [course('cve-102', 'Strength of Materials', 3, 'fitness', 'morning'), course('cve-104', 'Fluid Mechanics', 3, 'fitness', 'afternoon'), course('cve-106', 'Construction Practice', 3, 'hustle', 'morning'), course('mth-102-cve', 'Engineering Mathematics II', 3, 'coding', 'afternoon')]),
    ],
  }),
  english: programme({
    id: 'english', label: 'English', faculty: 'Arts', department: 'English', spot: 'arts', skill: 'charisma', careerTrack: 'teaching',
    semesters: [
      semester(1, [course('eng-101', 'Introduction to Literature', 3, 'charisma', 'morning'), course('eng-103', 'Language and Communication', 3, 'charisma', 'afternoon')]),
      semester(2, [course('eng-102', 'African Prose', 3, 'charisma', 'morning'), course('eng-104', 'Creative Writing', 3, 'charisma', 'afternoon')]),
    ],
  }),
  business: programme({
    id: 'business', label: 'Business Administration', faculty: 'Management Sciences', department: 'Business Administration',
    spot: 'management', skill: 'hustle', careerTrack: 'banking',
    semesters: [
      semester(1, [course('bus-101', 'Principles of Management', 3, 'hustle', 'morning'), course('bus-103', 'Business Communication', 3, 'charisma', 'afternoon')]),
      semester(2, [course('bus-102', 'Entrepreneurship', 3, 'hustle', 'morning'), course('bus-104', 'Organisational Behaviour', 3, 'charisma', 'afternoon')]),
    ],
  }),
  economics: programme({
    id: 'economics', label: 'Economics', faculty: 'Social Sciences', department: 'Economics',
    spot: 'social-sciences', skill: 'hustle', careerTrack: 'banking',
    semesters: [
      semester(1, [course('eco-101', 'Principles of Economics I', 3, 'hustle', 'morning'), course('eco-103', 'Quantitative Methods I', 3, 'coding', 'afternoon')]),
      semester(2, [course('eco-102', 'Principles of Economics II', 3, 'hustle', 'morning'), course('eco-104', 'Lagos Economy', 3, 'charisma', 'afternoon')]),
    ],
  }),
});

/** @param {string} id @returns {Programme|null} */
export const programmeOf = (id) => (typeof id === 'string' && Object.hasOwn(PROGRAMMES, id) ? PROGRAMMES[id] : null);
/** @param {string} programmeId @param {number} number @returns {Semester|null} */
export const semesterOf = (programmeId, number) => programmeOf(programmeId)?.semesters[number - 1] ?? null;
/** @param {string} programmeId @param {number} semesterNumber @param {string} courseId @returns {Course|null} */
export const courseOf = (programmeId, semesterNumber, courseId) => semesterOf(programmeId, semesterNumber)?.courses.find((item) => item.id === courseId) ?? null;
