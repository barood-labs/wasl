export const dict = {
  en: { 'tagline': 'Get paid the moment your video delivers', 'nav.dashboard': 'Dashboard', 'nav.new': '+ New deal' },
  ar: {
    'tagline': 'استلم أجرك لحظة تسليم الفيديو',
    'nav.dashboard': 'لوحة التحكم', 'nav.new': '+ صفقة جديدة',
    'Sponsorship escrow, verified by AI': 'ضمان صفقات الرعاية، بتحقق ذكي',
    'Brands fund a PayPal hold. Creators upload the video. Wasl checks every requirement with timestamped evidence, then releases and splits the money automatically.': 'العلامة التجارية تحجز المبلغ عبر PayPal، وصانع المحتوى يرفع الفيديو، ووصل يتحقق من كل شرط بأدلة مع التوقيت، ثم يحرر المبلغ ويوزعه تلقائياً.',
    'Held in escrow': 'محجوز بالضمان', 'Released': 'تم تحريره', 'Paid to collaborators': 'مدفوع للفريق', 'Avg. verification score': 'متوسط نتيجة التحقق',
    'Deals': 'الصفقات', 'Payouts ledger': 'سجل الدفعات', 'Agent activity': 'نشاط الوكيل', 'Money by status': 'الأموال حسب الحالة',
    'Ask your deals… e.g. “which deals need revisions over $500?”': 'اسأل عن صفقاتك… مثلاً: «أي الصفقات تحتاج تعديل وأكثر من ٥٠٠ دولار؟»',
    'Ask AI': 'اسأل الذكاء', 'Export CSV': 'تصدير CSV', 'Clear': 'مسح',
    'New sponsorship deal': 'صفقة رعاية جديدة', 'Paste the WhatsApp / Instagram chat with the brand — Arabic, English or both.': 'الصق محادثة واتساب أو إنستغرام مع العلامة التجارية — عربي أو إنجليزي أو الاثنين.',
    'Load sample chat': 'تحميل محادثة نموذجية', 'Structure with AI': 'نظّم الصفقة بالذكاء', 'Contract': 'العقد',
    'Deliverables (editable)': 'المتطلبات (قابلة للتعديل)', 'Money split (editable)': 'توزيع المبلغ (قابل للتعديل)', 'Create deal': 'إنشاء الصفقة',
    'Fund with PayPal': 'موّل عبر PayPal', 'Release now': 'حرر المبلغ الآن', 'Void hold': 'إلغاء الحجز',
    'Delivery': 'التسليم', 'Upload video': 'رفع الفيديو', 'Evidence': 'الأدلة', 'Transcript': 'النص المفرّغ', 'Timeline': 'الخط الزمني',
    'Funded': 'مموّل', 'Delivered': 'تم التسليم', 'Verified': 'تم التحقق', 'Released ': 'تم التحرير', 'Paid out': 'تم الدفع',
    'Funds': 'الأموال', 'Requirement': 'الشرط', 'Result': 'النتيجة', 'Method': 'الطريقة', 'At': 'التوقيت',
    'Title': 'العنوان', 'Brand': 'العلامة', 'Creator': 'صانع المحتوى', 'Amount': 'المبلغ', 'Status': 'الحالة', 'Score': 'النتيجة', 'Versions': 'النسخ', 'Deadline': 'الموعد', 'Lang': 'اللغة',
    'Role': 'الدور', 'Name': 'الاسم', 'Email': 'البريد', 'Share %': 'النسبة ٪', 'Payout': 'الدفعة', 'Deal': 'الصفقة',
    'Kind': 'النوع', 'Description': 'الوصف', 'Must say / show': 'يجب قوله / إظهاره', 'Within first (s)': 'خلال أول (ث)',
  },
};
let lang = localStorage.getItem('wasl.lang') || 'en';
export const getLang = () => lang;
export function setLang(l) { lang = l; localStorage.setItem('wasl.lang', l); }
export const t = (s) => (lang === 'ar' && dict.ar[s]) || dict.en[s] || s;
