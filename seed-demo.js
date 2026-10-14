'use strict';
/* OPTIONAL sample profiles so the website does not look empty while you present it.
   Double-click "start-with-sample-profiles.bat" to add them (only when there are none yet).
   To remove them: stop the server and delete data/db.json (this also removes every account).
   Sample profiles are view-only: they cannot log in, send replies, accept requests
   or receive messages. Real members are the only ones who talk to each other. */
const mdb = require('./db');

// [name, color, location, rating, swaps, level, availability, bio, teach[[skill,category,level,learners]], learn[], reviews[[by,text]]]
const RAW = [
  ['Rahul Verma', '#6C4DF6', 'Hyderabad', 4.8, 42, 'Intermediate', 'Weekdays 6 to 9 PM',
    'Final-year CS student who loves automating boring things with Python.',
    [['Python Programming', 'Programming', 'Intermediate', 120], ['Data Structures', 'Programming', 'Intermediate', 48]],
    ['Graphic Design', 'Photography'],
    [['Priya', 'Clear explanations and very patient.'], ['Karthik', 'Helped me finish my first script in one session.']]],
  ['Priya Sharma', '#FF6B5B', 'Bengaluru', 4.9, 37, 'Advanced', 'Weekends, flexible evenings',
    'Computer Science student passionate about web development and design.',
    [['HTML', 'Web Development', 'Beginner', 90], ['CSS', 'Web Development', 'Intermediate', 84], ['JavaScript', 'Web Development', 'Intermediate', 76], ['UI Design', 'Design', 'Intermediate', 52]],
    ['Python', 'Machine Learning'],
    [['Rahul', 'Great at explaining layouts step by step.'], ['Meera', 'My portfolio site looks amazing now.']]],
  ['Ananya Rao', '#0F9D8A', 'Vijayawada', 4.7, 29, 'Advanced', 'Evenings and Sundays',
    'Design student who builds brands, posters and social media kits.',
    [['Graphic Design', 'Design', 'Advanced', 64], ['Canva Basics', 'Design', 'Beginner', 110]],
    ['Python', 'Public Speaking'],
    [['Divya', 'Gave honest, useful feedback on my posters.'], ['Sam', 'Fun sessions and great examples.']]],
  ['Karthik Reddy', '#E09F1F', 'Chennai', 4.6, 21, 'Intermediate', 'Saturday mornings',
    'Weekend photographer who shoots street and portraits.',
    [['Photography', 'Photography', 'Intermediate', 58], ['Photo Editing', 'Photography', 'Beginner', 40]],
    ['JavaScript', 'Public Speaking'],
    [['Ananya', 'Taught me composition in an hour.']]],
  ['Sneha Iyer', '#D14D8B', 'Pune', 4.5, 18, 'Beginner', 'Weekday evenings',
    'Acoustic guitar player. Happy to help you play your first song.',
    [['Guitar', 'Music', 'Beginner', 46], ['Music Theory', 'Music', 'Beginner', 22]],
    ['Digital Marketing', 'Spanish'],
    [['Vikram', 'Super encouraging teacher.']]],
  ['Mohammed Faiz', '#2F80ED', 'Hyderabad', 4.6, 25, 'Advanced', 'Mornings before 10 AM',
    'English communication coach and debate club captain.',
    [['Spoken English', 'Languages', 'Advanced', 132]],
    ['SEO', 'Video Editing'],
    [['Neha', 'My confidence went up a lot.']]],
  ['Neha Gupta', '#8E44AD', 'Delhi', 4.7, 31, 'Intermediate', 'Weekends',
    'Marketing intern who runs a college club page with 10k followers.',
    [['SEO', 'Digital Marketing', 'Intermediate', 57], ['Social Media Marketing', 'Digital Marketing', 'Intermediate', 73]],
    ['Video Editing', 'Graphic Design'],
    [['Faiz', 'Practical tips I could use the same day.']]],
  ['Vikram Singh', '#16A085', 'Jaipur', 4.9, 51, 'Advanced', 'Weekdays after 5 PM',
    'Maths tutor who makes calculus feel simple.',
    [['Calculus', 'Academics', 'Advanced', 88], ['Statistics', 'Academics', 'Intermediate', 61]],
    ['Guitar', 'Photography'],
    [['Sneha', 'Finally understood limits!']]],
  ['Divya Menon', '#C0392B', 'Kochi', 4.8, 33, 'Advanced', 'Evenings',
    'Placement mentor. Resumes, mock interviews and public speaking.',
    [['Public Speaking', 'Career Skills', 'Advanced', 95], ['Resume Writing', 'Career Skills', 'Intermediate', 70]],
    ['Graphic Design', 'Excel'],
    [['Karthik', 'Her mock interview got me my offer.']]],
  ['Arun Kumar', '#34495E', 'Vijayawada', 4.7, 27, 'Advanced', 'Weekends',
    'Edits reels and short films. Premiere Pro and DaVinci Resolve.',
    [['Video Editing', 'Video Editing', 'Advanced', 66], ['Reels and Shorts', 'Video Editing', 'Beginner', 49]],
    ['Python', 'SEO'],
    [['Neha', 'Taught me cuts and pacing so fast.']]],
  ['Meera Nair', '#F39C12', 'Mumbai', 4.5, 15, 'Intermediate', 'Mornings and late evenings',
    'Productivity nerd. Time management and mindful study habits.',
    [['Time Management', 'Personal Development', 'Intermediate', 54], ['Mindfulness', 'Personal Development', 'Beginner', 33]],
    ['JavaScript', 'Canva Basics'],
    [['Priya', 'Practical routines that actually stick.']]],
  ['Sam Wilson', '#1ABC9C', 'Goa', 4.4, 12, 'Intermediate', 'Weekends',
    'Exchange student who loves teaching Spanish.',
    [['Spanish', 'Languages', 'Intermediate', 38]],
    ['Photography', 'Graphic Design'],
    [['Ananya', 'Fun conversation practice.']]]
];

async function seedDemo() {
  const { C } = mdb;
  if (await C.users.countDocuments({ demo: true })) return 0;
  const now = Date.now();
  let n = 0;
  for (const r of RAW) {
    const id = await mdb.nextId();
    await C.users.insertOne({
      id, email: `sample${id}@skillswap.local`, name: r[0], color: r[1], loc: r[2],
      rating: r[3], ratingCount: r[4], exchanges: r[4], exp: r[5], avail: r[6], bio: r[7],
      teach: r[8].map(t => ({ name: t[0], cat: t[1], level: t[2], base: t[3] })),
      learn: r[9],
      reviews: r[10].map((v, i) => ({ byId: null, byName: v[0], rating: 5, text: v[1], ts: now - 864e5 * (i + 2) })),
      demo: true, created: now
    });
    n++;
  }
  return n;
}

async function removeDemo() {
  const { C } = mdb;
  const ids = (await C.users.find({ demo: true }, { projection: { _id: 0, id: 1 } }).toArray()).map(u => u.id);
  if (!ids.length) return 0;
  await C.users.deleteMany({ demo: true });
  await C.connections.deleteMany({ $or: [{ from: { $in: ids } }, { to: { $in: ids } }] });
  await C.notifications.deleteMany({ userId: { $in: ids } });
  return ids.length;
}

module.exports = { seedDemo, removeDemo };

