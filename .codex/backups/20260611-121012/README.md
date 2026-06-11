# THANWYA

واجهة تشغيل أولية لمنصة تعليمية منظمة حسب السنة والشعبة، مع لوحة أدمن لتوليد أكواد الطلاب وإضافة الفيديوهات والـ PDF والامتحانات.

## التشغيل

```bash
npm install
npm run dev
```

للتشغيل المحلي افتح الرابط الذي يظهر مع `npm run dev`، ولا تفتح ملف [index.html](C:/Users/kokoh/OneDrive/Documents/THANWYA/index.html) مباشرة من الملفات لأن المشروع مبني بـ Vite و React ويحتاج dev server أو build.

الدخول التجريبي:

- الإدارة: الكود `admin`
- الطالب: الكود `test`

## ملاحظة مهمة عن حماية الفيديو

الحماية الموجودة في الواجهة تحاكي جلسة تشغيل بمفتاح متغير وعلامة مائية. الحماية الإنتاجية ضد أدوات التحميل تحتاج Backend حقيقي يطبق:

- HLS/DASH encrypted streaming بدل ملفات MP4 مباشرة.
- Signed playback sessions قصيرة العمر.
- Key rotation لكل نافذة زمنية أثناء التشغيل.
- CDN private origin مع signed cookies أو signed URLs.
- Watermarking باسم الطالب والكود داخل المشغل.
- تكامل DRM فعلي مثل Widevine/FairPlay/PlayReady لو مطلوب منع أقوى.

لا توجد واجهة Frontend وحدها تضمن منع النسخ 100% لأن أي شيء يظهر على جهاز الطالب يمكن تسجيله أو اعتراضه بدرجات مختلفة.

## النشر على GitHub Pages

- تم إعداد Workflow تلقائي داخل [.github/workflows/deploy-pages.yml](C:/Users/kokoh/OneDrive/Documents/THANWYA/.github/workflows/deploy-pages.yml).
- بعد رفع المشروع إلى فرع `main` أو `master`، GitHub سيشغل `npm ci` ثم `npm run build` ثم ينشر محتوى `dist` تلقائيًا.
- لا ترفع `dist` يدويًا إذا كنت ستستخدم هذا الـ workflow.
