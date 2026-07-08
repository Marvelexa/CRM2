const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const NEXT_PUBLIC_SUPABASE_URL = "https://sflxtawnonqumtumwkda.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmbHh0YXdub25xdW10dW13a2RhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjMxNjk1NSwiZXhwIjoyMDk3ODkyOTU1fQ.zLruXiB8Z8zzQUgCmj92kbO_DR4X86BF4-VG-6urid4";

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
function uuid() { return crypto.randomUUID(); }

const baseFeaturesAr = `
*💎 الباقة الأساسية (Starter) - $[START]*
_مثالية للشركات الجديدة والناشئة_
• موقع متكامل متجاوب (حتى 5 صفحات)
• متوافق مع الهواتف الذكية والأجهزة اللوحية
• نموذج اتصال (Contact Form)
• زر دردشة واتساب (WhatsApp Chat)
• ربط خرائط جوجل (Google Maps)
• ربط حسابات التواصل الاجتماعي
• تهيئة محركات البحث الأساسية (SEO)
• شهادة الأمان والحماية (SSL)
• دعم فني مجاني لمدة 30 يوماً

*🚀 باقة النمو (Growth) - $[GROWTH] (الأكثر طلباً)*
_تشمل جميع ميزات الباقة الأساسية، بالإضافة إلى:_
_💡 ملاحظة: الفيديو الذي أرسلناه لك هو مثال لمشروع بقيمة 599 دولار._
• حتى 15 صفحة
• كتالوج المنتجات / الخدمات
• صفحات الأقسام والخدمات
• تصميم واجهات متقدم (UI/UX)
• تأثيرات وحركات بصرية مميزة
• ربط واتساب API الرسمي
• نماذج التقاط بيانات العملاء
• ربط إحصائيات جوجل وبكسل فيسبوك
• تهيئة محركات البحث المتقدمة (SEO)
• تحسين سرعة الموقع والصور
• دعم فني مجاني لمدة 60 يوماً

*🛍️ الباقة الاحترافية (Professional) - $[PRO]*
_تشمل جميع ميزات باقة النمو، بالإضافة إلى:_
• متجر إلكتروني متكامل / نظام حجز
• نظام دفع إلكتروني آمن وسلة تسوق
• نظام تسجيل دخول العملاء وحساباتهم
• إدارة الطلبات والحجوزات
• نظام الكوبونات والخصومات
• قائمة المفضلة وفلاتر متقدمة
• إشعارات البريد الإلكتروني التلقائية
• نظام مدونة متكامل
• ربط دردشة حية (Live Chat)
• تحسين أداء وسرعة الموقع القصوى
• دعم فني مجاني لمدة 90 يوماً

*👑 باقة الشركات (Enterprise) - $1500+*
_حلول أعمال متكاملة ومخصصة_
• تشمل جميع ميزات الباقة الاحترافية
• تصميم واجهات مخصص بالكامل (Custom UI/UX)
• نظام رد تلقائي ذكي وبوت واتساب (AI Chatbot)
• ربط نظام إدارة العملاء والماركتنج (CRM)
• لوحة تحكم إدارية مخصصة
• نظام تحليلات متقدم
• دعم لغات متعددة وعملات متعددة
• إعداد شبكة توصيل المحتوى وحماية قصوى
• ربط الواجهات البرمجية (API)
• أولوية الدعم الفني
• صيانة مجانية لمدة 6 أشهر`;

function generatePricingMessageAr(title, startPrice) {
  let growthPrice = 599;
  if (startPrice >= 599) growthPrice = startPrice + 300; 
  let proPrice = 999;
  if (growthPrice >= 999) proPrice = growthPrice + 400;

  return `*${title}*\n\n` + baseFeaturesAr
    .replace('$[START]', '$' + startPrice)
    .replace('$[GROWTH]', '$' + growthPrice)
    .replace('$[PRO]', '$' + proPrice);
}

const industriesAr = [
  { key: 'biz_clothing', title: '👕 متجر ملابس وأزياء (Clothing)', price: 299 },
  { key: 'biz_restaurant', title: '🍽️ مطعم أو مقهى (Restaurant)', price: 349 },
  { key: 'biz_salon', title: '💄 صالون تجميل وسبا (Salon & Spa)', price: 299 },
  { key: 'biz_realestate', title: '🏠 عقارات ومقاولات (Real Estate)', price: 499 },
  { key: 'biz_healthcare', title: '🏥 عيادة أو مركز صحي (Healthcare)', price: 499 },
  { key: 'biz_retail', title: '🛒 متجر تجزئة (Retail Store)', price: 349 },
  { key: 'biz_education', title: '🎓 معهد أو مركز تعليمي (Education)', price: 399 },
  { key: 'biz_it', title: '💻 شركة تقنية ومعلومات (IT)', price: 699 },
  { key: 'biz_manufacturing', title: '🏭 مصنع أو ورشة (Manufacturing)', price: 599 },
  { key: 'biz_other', title: '📦 نشاط تجاري آخر (Other)', price: 299 }
];

async function addMarketingArabicFlow() {
  const { data: flows } = await supabase.from('flows').select('id').eq('name', 'Marketing Interest Flow').limit(1);
  if (!flows || flows.length === 0) {
    console.error("Marketing Interest Flow not found");
    return;
  }
  const flowId = flows[0].id;

  // Cleanup old arabic nodes if any exist
  await supabase.from('flow_nodes').delete().eq('flow_id', flowId).like('node_key', '%_ar');

  const nodes = [
    {
      id: uuid(), flow_id: flowId, node_key: 'welcome_buttons_ar', node_type: 'send_buttons',
      config: {
        text: 'مرحباً! أهلاً بك في Nexvora. شكراً لاهتمامك بخدماتنا. هل يمكنني أخذ دقيقة من وقتك لطرح بضعة أسئلة سريعة؟',
        buttons: [
          { reply_id: 'yes_ar', title: 'نعم (YES)', next_node_key: 'ask_city_ar' },
          { reply_id: 'no_ar', title: 'لا (NO)', next_node_key: 'say_goodbye_ar' }
        ]
      }, position_x: 600, position_y: -600
    },
    {
      id: uuid(), flow_id: flowId, node_key: 'say_goodbye_ar', node_type: 'send_message',
      config: { text: "شكراً لوقتك. إذا كنت بحاجة إلى خدماتنا في المستقبل، فنحن دائماً هنا للمساعدة. نتمنى لك يوماً سعيداً!", next_node_key: 'end_flow' },
      position_x: 600, position_y: -500
    },

    // Location (Arabic)
    {
      id: uuid(), flow_id: flowId, node_key: 'ask_city_ar', node_type: 'send_list',
      config: {
        text: "شكراً لوقتك. دعنا نبدأ بالسؤال الأول. في أي بلد يقع عملك؟",
        button_label: "اختر البلد",
        sections: [{
          title: "البلدان", rows: [
            { reply_id: 'loc_kw_ar', title: '🇰🇼 الكويت (Kuwait)', next_node_key: 'ask_business_type_ar' },
            { reply_id: 'loc_ae_ar', title: '🇦🇪 الإمارات (UAE)', next_node_key: 'ask_business_type_ar' },
            { reply_id: 'loc_sa_ar', title: '🇸🇦 السعودية (KSA)', next_node_key: 'ask_business_type_ar' },
            { reply_id: 'loc_qa_ar', title: '🇶🇦 قطر (Qatar)', next_node_key: 'ask_business_type_ar' },
            { reply_id: 'loc_om_ar', title: '🇴🇲 عمان (Oman)', next_node_key: 'ask_business_type_ar' },
            { reply_id: 'loc_bh_ar', title: '🇧🇭 البحرين (Bahrain)', next_node_key: 'ask_business_type_ar' },
            { reply_id: 'loc_other_ar', title: '🌍 بلد آخر', next_node_key: 'ask_custom_city_ar' }
          ]
        }]
      }, position_x: 900, position_y: -300
    },
    {
      id: uuid(), flow_id: flowId, node_key: 'ask_custom_city_ar', node_type: 'collect_input',
      config: { prompt_text: "يرجى كتابة اسم مدينتك وبلدك.", var_key: 'custom_location', next_node_key: 'ask_business_type_ar' },
      position_x: 1200, position_y: -300
    },

    // Business Type (Arabic)
    {
      id: uuid(), flow_id: flowId, node_key: 'ask_business_type_ar', node_type: 'send_list',
      config: {
        text: 'ما هو نوع النشاط التجاري الذي تديره؟', button_label: 'اختر نوع النشاط',
        sections: [{ title: 'الأنشطة التجارية', rows: industriesAr.map(ind => ({ reply_id: ind.key + '_ar', title: ind.title.substring(0, 24), next_node_key: ind.key === 'biz_other' ? 'ask_other_biz_ar' : `pricing_${ind.key}_ar` })) }]
      }, position_x: 900, position_y: -200
    },
    {
      id: uuid(), flow_id: flowId, node_key: 'ask_other_biz_ar', node_type: 'collect_input',
      config: { prompt_text: 'يرجى إخبارنا بنوع نشاطك التجاري.', var_key: 'custom_business_type', next_node_key: 'pricing_biz_other_ar' },
      position_x: 1200, position_y: -200
    }
  ];

  industriesAr.forEach((ind, i) => {
    nodes.push({
      id: uuid(), flow_id: flowId, node_key: `pricing_${ind.key}_ar`, node_type: 'send_message',
      config: { text: generatePricingMessageAr(ind.title, ind.price), next_node_key: 'ask_package_ar' },
      position_x: 900, position_y: -100 + (i * 10)
    });
  });

  nodes.push(
    {
      id: uuid(), flow_id: flowId, node_key: 'ask_package_ar', node_type: 'send_list',
      config: {
        text: 'ما هي باقة الأسعار التي ترغب في البدء بها؟', button_label: 'اختر الباقة',
        sections: [{ title: 'الباقات', rows: [
          { reply_id: 'pkg_starter_ar', title: '💎 الأساسية (Starter)', next_node_key: 'ask_timeline_ar' },
          { reply_id: 'pkg_growth_ar', title: '🚀 النمو (Growth)', next_node_key: 'ask_timeline_ar' },
          { reply_id: 'pkg_pro_ar', title: '🛍️ الاحترافية (Pro)', next_node_key: 'ask_timeline_ar' },
          { reply_id: 'pkg_enterprise_ar', title: '👑 الشركات (Enterprise)', next_node_key: 'ask_timeline_ar' }
        ]}]
      }, position_x: 900, position_y: 100
    },
    {
      id: uuid(), flow_id: flowId, node_key: 'ask_timeline_ar', node_type: 'send_list',
      config: {
        text: 'ما هي المدة الزمنية المطلوبة لإنجاز موقعك/مشروعك؟', button_label: 'اختر المدة',
        sections: [{ title: 'المدة الزمنية', rows: [
          { reply_id: 'time_asap_ar', title: 'بأسرع وقت ممكن (ASAP)', next_node_key: 'confirm_info_ar' },
          { reply_id: 'time_1wk_ar', title: 'خلال أسبوع واحد (1 Week)', next_node_key: 'confirm_info_ar' },
          { reply_id: 'time_2_4wks_ar', title: 'خلال 2-4 أسابيع', next_node_key: 'confirm_info_ar' },
          { reply_id: 'time_1_2mo_ar', title: 'خلال 1-2 شهر', next_node_key: 'confirm_info_ar' },
          { reply_id: 'time_explore_ar', title: 'مجرد استطلاع للأسعار', next_node_key: 'confirm_info_ar' }
        ]}]
      }, position_x: 900, position_y: 200
    },
    {
      id: uuid(), flow_id: flowId, node_key: 'confirm_info_ar', node_type: 'send_buttons',
      config: {
        text: "شكراً لمشاركتك متطلباتك. يسعدنا العمل معك. بناءً على إجاباتك، سيقوم فريقنا بإعداد أفضل حل لعملك.\n\nقبل المتابعة، هل ترغب في تعديل أي من المعلومات التي قدمتها؟",
        buttons: [
          { reply_id: 'btn_correct_ar', title: '✅ كل شيء صحيح', next_node_key: 'final_success_ar' },
          { reply_id: 'btn_change_ar', title: '✏️ تعديل المعلومات', next_node_key: 'ask_change_category_ar' }
        ]
      }, position_x: 900, position_y: 300
    },
    {
      id: uuid(), flow_id: flowId, node_key: 'ask_change_category_ar', node_type: 'send_list',
      config: {
        text: "لا توجد مشكلة! يرجى اختيار القسم الذي ترغب في تعديله، وسنقوم بتعديله قبل المتابعة.", button_label: 'اختر القسم',
        sections: [{ title: 'الأقسام', rows: [
          { reply_id: 'chg_city_ar', title: '📍 البلد والمدينة', next_node_key: 'ask_city_ar' },
          { reply_id: 'chg_biz_ar', title: '🏢 نوع النشاط التجاري', next_node_key: 'ask_business_type_ar' },
          { reply_id: 'chg_pkg_ar', title: '📦 باقة الأسعار', next_node_key: 'ask_package_ar' },
          { reply_id: 'chg_time_ar', title: '⏰ المدة الزمنية', next_node_key: 'ask_timeline_ar' }
        ]}]
      }, position_x: 1200, position_y: 300
    },
    {
      id: uuid(), flow_id: flowId, node_key: 'final_success_ar', node_type: 'send_message',
      config: { text: "ممتاز! 🎉 تم تقديم معلوماتك بنجاح. سيقوم فريقنا بمراجعة متطلباتك والتواصل معك قريباً لتقديم عرض مخصص. شكراً لاختيارك Nexvora. نتطلع لمساعدتك في نمو عملك!", next_node_key: 'end_flow' },
      position_x: 600, position_y: 400
    }
  );

  // Insert the Arabic flow nodes
  const { error: insertErr } = await supabase.from('flow_nodes').insert(nodes);
  if (insertErr) {
    console.error("Error inserting Arabic nodes:", insertErr);
    return;
  }
  console.log("Arabic nodes inserted successfully!");

  // Now, let's update the ask_language node to include Arabic!
  const { data: langNodes } = await supabase.from('flow_nodes').select('*').eq('flow_id', flowId).eq('node_key', 'ask_language');
  if (langNodes && langNodes.length > 0) {
    const langNode = langNodes[0];
    const newConfig = {
      text: 'Please select your preferred language / اختر لغتك المفضلة / कृपया अपनी पसंदीदा भाषा चुनें',
      buttons: [
        { reply_id: 'lang_en', title: 'English', next_node_key: 'welcome_buttons' },
        { reply_id: 'lang_ar', title: 'العربية (Arabic)', next_node_key: 'welcome_buttons_ar' },
        { reply_id: 'lang_hi', title: 'हिंदी (Hindi)', next_node_key: 'welcome_buttons_hi' }
      ]
    };
    const { error: updateErr } = await supabase.from('flow_nodes').update({ config: newConfig }).eq('id', langNode.id);
    if (updateErr) {
      console.error("Error updating ask_language node:", updateErr);
    } else {
      console.log("ask_language node updated to include Arabic button successfully!");
    }
  } else {
    console.error("ask_language node not found!");
  }
}

addMarketingArabicFlow().catch(console.error);
