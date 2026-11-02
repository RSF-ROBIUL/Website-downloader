# 🧹 ফেজ ২ — কোড-কোয়ালিটি ইনফ্রা (Developer Experience & Hygiene)

> **অগ্রাধিকার:** উচ্চ — ফেজ ১-এর পরে চালু করা উচিত; নতুন ফিচার (ফেজ ৩+) লেখার **আগে** এটা রাখলে ভালো, কারণ linting/test না-থাকায় সব কাজের মান অনিশ্চিত থাকে।
> **সময়-খরচ (আনুমানিক):** ১–২ দিন।
> **সূত্র:** surgical audit-এর hygiene বিভাগ।

---

## উদ্দেশ্য

নতুন কোড লেখার/পরিবর্তনের মান বাড়ানো — টেস্ট, লিন্ট, ফরম্যাটিং, নিরাপত্তা-হেডার, npm-script ও package metadata-র বাস্তব ভিত্তি তৈরি করা।

---

## কাজ তালিকা

### ২.১ Dead code ও dead dependency সরিয়ে ফেলা

**সমস্যা (audit থেকে):**
- `jszip`, `socket.io-client`, `cookie-parser` — কোনোটা কাজের কোডে ایرانی
- `routes/users.js` — express-generator scaffold ("respond with a resource")

**করণীয়:**
- [ ] `package.json` থেকে `jszip`, `socket.io-client` অপসারণ (ক্লায়েন্ট `/socket.io/socket.io.js` নিজেই সার্ভ-করে)
- [ ] `cookie-parser` — `app.js` থেকে মাউন্ট ও import দুটোই বাদ; `package.json` থেকেও বাদ
- [ ] `routes/users.js` ফাইল + এর `app.use('/users', ...)` লাইন অপসারণ
- [ ] ফাইলগুলো ফেলে দেওয়ার আগে `grep -r` দিয়ে নিশ্চিত করা যে কোথাও অন্য জায়গা থেকে টানা হয়নি

### ২.₂ npm-script ও মেটাডেটা (ওয়েল-হেরা-প্র্যাক)

**সমস্যা:** `dev` স্ক্রিপ্ট `export NODE_ENV=Development && npm start` — Windows (মালিকের মেশিন) এ `export` বাশ-শব্দ, cmd/powershell-এ fail; `engines`-ফিল্ড নেই।

**করণীয়:**
- [ ] `cross-env` ডিপ হিসেবে যোগ; `dev` স্ক্রিপ্ট → `cross-env NODE_ENV=development node ./bin/www`
- [ ] `package.json` এ যোগ: `"engines": {"node": ">=18"}` + `os`/`license`/`description`/`repository` সুস্পষ্ট করা
- [ ] `main` ফিল্ড ঠিক করা (`./bin/www`), প্রা-প্রয়োজন হলে `debug` স্রেফ রাখা

### ২.৩ ESLint + Prettier + Husky (কোড-মান আরোপ)

- [ ] `devDependencies`: `eslint`, `eslint-config-standard`, `prettier`, `husky`, `lint-staged`
- [ ] `.eslintrc.json` + `.prettierrc` তৈরি — বর্তমানে `var`-ভিত্তিক কোড (কোডের ৬+ জায়গা) নতুন ES-lint config-এর সাথে মিলবে নাকি থাকবে সেটা এক সিদ্ধান্তে স্থাপন
- [ ] `husky` pre-commit: `lint-staged` — চেঞ্জ হওয়া ফাইল lint/reformat
- [ ] প্রথম `lint-fix` pass-এ পুরো repo একবার আমল করা (auto-fixable শুধু)

### ২.৪ টেস্ট-বেসট্রাক (প্রথম টেস্ট প্লেটফর্ম)

**সমস্যা:** একটা পর্যন্ত টেস্ট নেই।

**করণীয় (সন্দেশ: ন্যূনতম-কিন্তু-সত্যিটা সরানো):**
- [ ] `mocha` + `chai` (বর্তমান `var`-JS-এ সবচেয়ে হালকা খাপ) — `test/` ফোল্ড
- [ ] ৬টি প্রাণ-টেস্ট (প্রথম কাজে সার্থক):
  1. `parseTarget()` — ভাল/খেয়াল URL প্রতিবার সঠিক ডিসিশন
  2. `isBlockedHost()` (SSRF, ফেজ ১-এর হেল্পার) — সব private/loopback IP ব্লক
  3. `explainFailure()` — wget stderr থেকে বোঝাপড়া সঠিক
  4. `countFiles()` — ফোল্ডার-গাছে সঠিক count
  5. `removeJobDir()` — outside-সাইটে নারি রোধ
  6. হোম route `GET /` renders 200
- [ ] `npm test` script + GitHub Action-এ চালানো-বিন্যাস

### ২.৫ নিরাপত্তা-হেডার (helmet)

**সমস্যা:** CSP, HSTS, X-Content-Type-Options কোনোটা নেই; inline script ও CDN (bootstrap) ব্যবহার আছে।

**করণীয়:**
- [ ] `helmet` ডিপ; `app.js`-এ router-এর **আগে** মাউন্ট
- [ ] CSP প্রথমে সামান্য-মিতব্য করে (inline-analytics ও গিটহাব-buttons CDN সাপোর্ট-হিসেবে অনুমতি), ধীরে ধীরে কঠোর করা
- [ ] মূল Google Analytics `UA-120895783-4` (মূল লেখকের প্রোপার্টি) — মালিকের নিজের A বা ব্লক করা; এক সিদ্ধান্ত নেওয়ার জন্য "প্রশ্ন"

### ২.৬ ব্রোকেন UI পিস (ছোট ছোট UX-বাগ)

- [ ] `views/index.hbs`-এ Google Inbox ডটা `intro-logo.png` URL মৃত — ব্রাউজারে 404; হয় নিজস্ব লোগো-নে `public/images/` এ নিয়ে-আনা, নয়-এন্ট্রি-ইরাফ অপসারণ
- [ ] `views/layout.hbs`-এ `console.log(event)` (প্রতি socket ইভেন্টেই লগ) — ডিভাণ-comment বা debug-enable করা প্রয়োজন-সূচে গার্ড
- [ ] `<footer>`/লাইসেনস-মিড ঠিক ধরতে দেওয়া, README ও সাইট শিরোনাম কর্ম্যাটুর-ফিক্স

---

## Acceptance Criteria

- [ ] `npm test` সব টেস্ট পাস করে (কম সে-ও ৬টি ভিত্তি-টেস্ট)
- [ ] `npm run lint` কোনো error দেয় না
- [ ] `npm run dev` Windows cmd/PowerShell উভয়েই চলে
- [ ] পেজ-কনসোলে প্রতি-ইভেন্টে বিড়ালশাহ-লোগ নেই
- [ ] npm package ৩টি apr אורনো ডিপ ছাড়া চলছে
- [ ] GitHub Action-এ Node 18/22 OS-এ টেস্ট মারা যায়

---

**স্ট্যাটাস:** ⬜ শুরু হয়নি।
