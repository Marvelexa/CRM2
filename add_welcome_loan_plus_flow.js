const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const NEXT_PUBLIC_SUPABASE_URL = "https://sflxtawnonqumtumwkda.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmbHh0YXdub25xdW10dW13a2RhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjMxNjk1NSwiZXhwIjoyMDk3ODkyOTU1fQ.zLruXiB8Z8zzQUgCmj92kbO_DR4X86BF4-VG-6urid4";

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
function uuid() { return crypto.randomUUID(); }

const targetAccountId = '6b428da4-3ce6-47aa-8002-53296da16e9a'; // Rajesh Pandey's account
const targetUserId = '98f9f722-3347-4b0a-a6d2-c89ada01ec1f'; // Rajesh user id

const texts = {
  hi: {
    select_lang: "आगे बढ़ने के लिए कृपया अपनी पसंदीदा भाषा चुनें / Please select your preferred language to proceed:",
    meet_ask: "रिस्पॉन्स के लिए धन्यवाद सर! हम कब मिल सकते हैं?",
    time_ask: "कृपया मिलने का सही समय चुनें सर:",
    addr_ask: "हम आपको कॉल करके ही आयेंगे, क्या आप हमे अपना ऑफिस एड्रेस और लोकेशन शेयर कर दीजिए!",
    pref_ask: "धन्यवाद आपका....🙏🏻\n\nक्या आप हमसे मिलकर ही सारी जानकारी लेना चाहते है या कुछ प्राथमिक जानकारी हम अभी आप से शेयर करें?",
    pref_no_msg: "ठीक है सर, मीटिंग के समय मिलते हैं। धन्यवाद! 🙏",
    info_prompt: "Okay, आप बताएं आप क्या जानना चाहते हैं??",
    opt_back: "🏠 मुख्य मेनू"
  },
  en: {
    select_lang: "Please select your preferred language to proceed / आगे बढ़ने के लिए कृपया भाषा चुनें:",
    meet_ask: "Thank you for your response, Sir! When can we meet?",
    time_ask: "Please choose a convenient time slot for our meeting, Sir:",
    addr_ask: "We will call you before arriving. Could you please share your office address and location with us?",
    pref_ask: "Thank you....🙏🏻\n\nWould you like to get all the details when we meet, or should we share some preliminary information with you right now?",
    pref_no_msg: "Sure Sir, we will connect during our meeting. Thank you! 🙏",
    info_prompt: "Okay, please let us know what you would like to know:",
    opt_back: "🏠 Main Menu"
  },
  gu: {
    select_lang: "આગળ વધવા માટે કૃપા કરીને તમારી પસંદગીની ભાષા પસંદ કરો:",
    meet_ask: "પ્રતિસાદ આપવા બદલ આભાર સર! આપણે ક્યારે મળી શકીએ?",
    time_ask: "કૃપા કરીને મળવાનો યોગ્ય સમય પસંદ કરો સર:",
    addr_ask: "અમે તમને ફોન કરીને જ આવીશું, શું તમે અમને તમારી ઓફિસનું સરનામું (એડ્રેસ) અને લોકેશન શેર કરશો?",
    pref_ask: "ખૂબ ખૂબ આભાર તમારો....🙏🏻\n\nશું તમે અમને રૂબરૂ મળીને જ બધી માહિતી મેળવવા માંગો છો કે કેટલીક પ્રાથમિક માહિતી અમે અત્યારે જ તમારી સાથે શેર કરીએ?",
    pref_no_msg: "બરાબર સર, આપણે મીટિંગ દરમિયાન જ ચર્ચા કરીશું. આભાર! 🙏",
    info_prompt: "ઓકે, તમે જણાવો કે તમે શું જાણવા માંગો છો??",
    opt_back: "🏠 મુખ્ય મેનૂ"
  },
  ta: {
    select_lang: "தொடர தயவுசெய்து உங்கள் விருப்பமான மொழியைத் தேர்ந்தெடுக்கவும்:",
    meet_ask: "பதிலளித்ததற்கு நன்றி சார்! நாம் எப்போது சந்திக்கலாம்?",
    time_ask: "தயவுசெய்து சந்திப்பிற்கான பொருத்தமான நேரத்தைத் தேர்ந்தெடுக்கவும் சார்:",
    addr_ask: "நாங்கள் உங்களுக்கு அழைத்த பிறகே வருவோம், தயவுசெய்து உங்கள் அலுவலக முகவரி மற்றும் இருப்பிடத்தை எங்களுடன் பகிர்ந்து கொள்ள முடியுமா?",
    pref_ask: "மிக்க நன்றி சார்....🙏🏻\n\nசந்திக்கும் போது அனைத்து விவரங்களையும் பெற விரும்புகிறீர்களா, அல்லது சில ஆரம்ப தகவல்களை இப்போது உங்களுடன் பகிர்ந்து கொள்ள வேண்டுமா?",
    pref_no_msg: "நிச்சயமாக சார், நாம் சந்திப்பின் போது பேசலாம். நன்றி! 🙏",
    info_prompt: "சரி, நீங்கள் என்ன தெரிந்து கொள்ள விரும்புகிறீர்கள் என்று சொல்லுங்கள்:",
    opt_back: "🏠 முதன்மை மெனு"
  }
};

const menuOptions = {
  hi: [
    { id: "opt_about", title: "1. हमारे बारेमें", desc: "कंपनी प्रोफाइल और ट्रैक रिकॉर्ड" },
    { id: "opt_comm", title: "2. लोन कमीशन स्लैब", desc: "किस लोन पर कितना कमीशन" },
    { id: "opt_timeline", title: "3. पेआउट समय सीमा", desc: "कमीशन कब क्रेडिट होगा" },
    { id: "opt_support", title: "4. फाइल सपोर्ट", desc: "फाइल प्रोसेसिंग के लिए संपर्क" },
    { id: "opt_security", title: "5. डेटा सुरक्षा गारंटी", desc: "कस्टमर डिटेल्स की गोपनीयता" },
    { id: "opt_default", title: "6. डिफ़ॉल्ट पॉलिसी", desc: "लोन डिफ़ॉल्ट होने पर नियम" },
    { id: "opt_cibil", title: "7. सिबिल इश्यूज गाइड", desc: "कम सिबिल वाली फाइलों की पॉलिसी" }
  ],
  en: [
    { id: "opt_about", title: "1. About Loan Plus", desc: "Our profile and legacy" },
    { id: "opt_comm", title: "2. Commission Payouts", desc: "Payout slab per loan product" },
    { id: "opt_timeline", title: "3. Payout Timeline", desc: "Payment days and schedule" },
    { id: "opt_support", title: "4. File Support", desc: "Processing contacts" },
    { id: "opt_security", title: "5. Data & Privacy", desc: "Data security commitment" },
    { id: "opt_default", title: "6. Default Policy", desc: "Payment defaults consequences" },
    { id: "opt_cibil", title: "7. CIBIL Problems Guide", desc: "Handling low CIBIL profiles" }
  ],
  gu: [
    { id: "opt_about", title: "1. અમારા વિશે", desc: "કંપની પ્રોફાઇલ અને ઇતિહાસ" },
    { id: "opt_comm", title: "2. લોન કમિશન સ્લેબ", desc: "કઈ લોન પર કેટલું કમિશન" },
    { id: "opt_timeline", title: "3. કમિશન ક્યારે મળશે", desc: "બેંક ટ્રાન્સફર સમયગાળો" },
    { id: "opt_support", title: "4. પ્રોસેસિંગ સપોર્ટ", desc: "ફાઇલ માટે કોનો સંપર્ક કરવો" },
    { id: "opt_security", title: "5. ડેટา સુરક્ષા ગેરંટી", desc: "ગ્રાહક વિગતોની સુરક્ષા" },
    { id: "opt_default", title: "6. કસ્ટમર ડિફોલ્ટ નીતિ", desc: "લોન ડિફોલ્ટ થવા પરના નિયમો" },
    { id: "opt_cibil", title: "7. સિબિલ માર્ગદર્શિકા", desc: "ખરાબ સિબિલ સ્કોર ફાઇલ નીતિ" }
  ],
  ta: [
    { id: "opt_about", title: "1. எங்களைப் பற்றி", desc: "நிறுவனத்தின் சுயவிவரம் மற்றும் வரலாறு" },
    { id: "opt_comm", title: "2. கமிஷன் விவரங்கள்", desc: "வழங்கப்படும் கமிஷன் சதவீதம்" },
    { id: "opt_timeline", title: "3. கமிஷன் காலம்", desc: "கமிஷன் வங்கிக்கு வரும் நாட்கள்" },
    { id: "opt_support", title: "4. கோப்பு ஆதரவு", desc: "தொடர்பு கொள்ள வேண்டிய விவரங்கள்" },
    { id: "opt_security", title: "5. தரவு பாதுகாப்பு", desc: "பாதுகாப்பு மற்றும் தனியுரிமை உறுதி" },
    { id: "opt_default", title: "6. தவணைத் தவறுகள்", desc: "கடனைத் திருப்பிச் செலுத்தத் தவறினால்" },
    { id: "opt_cibil", title: "7. சிபில் வழிகாட்டி", desc: "குறைந்த சிபில் கோப்புகளுக்கான வழிகாட்டி" }
  ]
};

const answers = {
  hi: {
    opt_about: `🤝 *Loan Plus – 15+ वर्षों का विश्वास और साझेदारी!* 🤝\n\nनमस्कार!\nहम भारत के एक अग्रणी कॉर्पोरेट लोन कंसल्टिंग फर्म हैं। पिछले *15+ वर्षों* से अधिक समय से हम देश के प्रमुख व्यवसायों, स्टोर मालिकों और व्यक्तिगत ग्राहकों को सर्वोत्तम वित्तीय समाधान प्रदान कर रहे हैं।\n\n• *50+ बैंकों और NBFCs* का विशाल नेटवर्क।\n• *7,000+ से अधिक* संतुष्ट ग्राहक।\n• अब तक *100+ करोड़ रुपये* से अधिक के लोन सफलतापूर्वक प्रोसेस किए गए।\n\nहमारा मुख्य उद्देश्य यह सुनिश्चित करना है कि आपको और आपके ग्राहकों को न्यूनतम दस्तावेज़ीकरण और सबसे कम ब्याज दरों पर लोन प्राप्त हो। हमारे बारे में अधिक जानने के लिए आप हमारे डिजिटल पोर्टफोलियो को देख सकते हैं:\n🌐 *loan-plus.onrender.com*`,
    opt_comm: `🤝 *Grow with Loan Plus – बड़े वॉल्यूम की ताकत, सबसे बड़ा कमीशन!* 🤝\n\nनमस्कार!\nहम एक अग्रणी कॉर्पोरेट लोन कंसलटेंट हैं और पूरे भारत (PAN India) में काम करते हैं। हमारा राष्ट्रव्यापी वॉल्यूम बहुत बड़ा होने के कारण, बैंकों और NBFCs के बड़े टारगेट हमारे प्लेटफॉर्म पर पहले से ही पूरे रहते हैं।\n\n*हमारे साथ जुड़ने का सबसे बड़ा फायदा:*\nआपको किसी भी बैंक में व्यक्तिगत रूप से कोई टारगेट पूरा करने की कोई जरूरत नहीं है। हम सभी पार्टनर्स का वॉल्यूम एक साथ जुड़ता है, जिससे सीधे *हाईएस्ट स्लैब (Highest Slab)* वाला कमीशन अनलॉक हो जाता है। यही कारण है कि हम अपने पार्टनर्स को इंडस्ट्री का सबसे बेस्ट पेआउट प्रदान करते हैं।\n\nहमारे साथ जुड़कर आप होम लोन, MSME, BG (बैंक गारंटी) और LC (लेटर ऑफ क्रेडिट) जैसे सभी बड़े प्रोडक्ट्स पर बेहतरीन कमीशन कमा सकते हैं।`,
    opt_timeline: `💼 *Loan Plus – पूर्ण पारदर्शिता और समय पर सुरक्षित पेआउट* 💼\n\nनमस्कार!\nहमारे साथ काम करते समय आपको अपनी फाइल और पेआउट को लेकर पूरी पारदर्शिता मिलती है। इसकी पूरी प्रक्रिया बेहद स्पष्ट और सुरक्षित है:\n\n📑 *सटीक कन्फर्मेशन:* किसी भी बैंक या NBFC में जैसे ही आपकी फाइल (बिना किसी पेंडेंसी के) पूरी तरह कम्पलीट होती है, संबंधित लॉगिन मैनेजर द्वारा सीधे आपको और हमें इसका तुरंत कन्फर्मेशन दिया जाता है। इस पूरी प्रक्रिया में आप पूरी तरह लूप में (जुड़े) रहते हैं।\n\n💰 *फास्ट बैंक ट्रांसफर:* कन्फर्मेशन मिलने के मात्र *2 से 15 वर्किंग डेज (Working Days)* के भीतर आपका तय कमीशन सीधे आपके बैंक अकाउंट में क्रेडिट कर दिया जाता है।\n\nLoan Plus के साथ जुड़ें, जहाँ आपका बिज़नेस पूरी तरह पारदर्शी और आपका पेआउट हमेशा समय पर सुरक्षित रहता है।`,
    opt_support: `🛠️ *Loan Plus – आपकी सुविधा और आज़ादी, हमारा मजबूत सपोर्ट!* 🛠️\n\nनमस्कार!\nहमारे साथ पार्टनरशिप में काम करते समय, आपके पास अपनी फाइलों को प्रोसेस करने के *दो बेहतरीन और आसान रास्ते* होते हैं, जिन्हें आप अपनी सुविधा के अनुसार चुन सकते हैं:\n\n1. *विकल्प 1 (परामर्श और गाइडेंस):* जैसे ही आपके पास कोई फाइल आए, आप सीधे हमसे संपर्क करके उसकी बेसिक जानकारी हमारे साथ साझा कर सकते हैं। हमारी एक्सपर्ट टीम आपको तुरंत गाइड करेगी कि यह फाइल किस बैंक या NBFC में सबसे आसानी से अप्रूव हो सकती है।\n\n2. *विकल्प 2 (डायरेक्ट वर्किंग):* यदि आप खुद प्रोसेस करना चाहते हैं, तो हम आपको सभी प्रमुख बैंकों और NBFCs के संबंधित मैनेजर्स के डायरेक्ट नंबर्स प्रदान कर देंगे। आप अपने अनुभव के आधार पर सीधे उनसे बात करके फाइल की प्रक्रिया को आगे बढ़ा सकते हैं।\n\n*हमारा वादा:* आप दोनों में से कोई भी रास्ता चुनें, पूरी प्रक्रिया के दौरान आने वाली किसी भी प्रकार की समस्या या क्वेरी को हल करने के लिए हमारी बैकएंड टीम हमेशा आपकी सेवा में तत्पर रहेगी। आइए, मिलकर आपके लोन बिज़नेस को और आसान और सुचारू बनाएं!`,
    opt_security: `🔒 *Loan Plus – शत-प्रतिशत डेटा सुरक्षा और गोपनीयता का भरोसा* 🔒\n\nनमस्कार!\nफाइनेंस इंडस्ट्री में डेटा की सुरक्षा सबसे महत्वपूर्ण है, और हम आपके क्लाइंट्स की गोपनीयता का पूरा सम्मान करते हैं। आपके ग्राहकों की डिटेल्स किसी भी अन्य एजेंट या मैनेजर द्वारा कभी भी गलत इस्तेमाल नहीं की जा सकतीं। इसी पूर्ण सुरक्षा और पारदर्शिता को बनाए रखने के लिए हम आपको *दो पारदर्शी रास्ते* देते हैं:\n\n1. *सिर्फ बेसिक इनफॉर्मेशन शेयर करें:* आप ग्राहकों के नाम या पर्सनल डिटेल्स छुपाकर, केवल फाइल की बेसिक प्रोफाइल (जैसे इनकम, सिबिल, लोन अमाउंट) हमारे साथ साझा करके यह जान सकते हैं कि फाइल किस बैंक या NBFC से अप्रूव होगी।\n\n2. *डायरेक्ट मैनेजर कनेक्टिविटी:* हम आपको सीधे बैंकों के अधिकृत मैनेजर्स के नंबर्स प्रदान कर देंगे। आप खुद सीधे उनसे संपर्क करके फाइल प्रोसेस कर सकते हैं। इस तरीके में आपको अपने ग्राहक का कोई भी डेटा हमारे साथ साझा करने की बिल्कुल आवश्यकता नहीं होती।\n\n*हमारा संकल्प:* आपका डेटा और आपके क्लाइंट्स हमेशा *100% सुरक्षित और सिर्फ आपके* ही रहेंगे। Loan Plus के साथ जुड़ें और पूरी निश्चिंतता के साथ अपना बिज़नेस बढ़ाएं।`,
    opt_default: `🤝 *Loan Plus – नैतिकता, साख और दीर्घकालिक साझेदारी* 🤝\n\nनमस्कार!\nफाइनेंस सेक्टर में एक सफल और लंबा सफर तय करने के लिए सबसे महत्वपूर्ण स्तंभ है - *'नैतिकता और साख'*। लोन देने के बाद यदि कोई कस्टमर तुरंत डिफॉल्ट करता है, तो नैतिक रूप से यह हम सभी की जिम्मेदारी बनती है। हम जानते हैं कि जब हमारे पार्टनर्स और बैंक दोनों सुरक्षित रहेंगे, तभी हम लंबे समय तक एक साथ जुड़े रह सकते हैं।\n\nइसीलिए, हमें कुछ बातों का विशेष ध्यान रखना आवश्यक है:\n\n🔍 *सटीक जांच:* लोन प्रोसेस करने से पहले ग्राहक की नीयत और रीपेमेंट क्षमता की पूरी जांच कर लें, ताकि भविष्य में आप या हम किसी भी प्रकार की कानूनी उलझनों में न फंसें।\n\n🚫 *जीरो टॉलरेंस:* इस डिजिटल युग में हर रिकॉर्ड ऑनलाइन है। हमें जानबूझकर किसी भी प्रकार का डिफॉल्ट नहीं कराना है और न ही ऐसे मामलों को बढ़ावा देना है, क्योंकि हमारी असली संपत्ति हमारा "नाम और मार्केट क्रेडिबिलिटी" है।\n\n🤝 *रिकवरी में सहयोग:* यदि जेन्युइन (वास्तविक) कारणों से कोई ग्राहक किसी समस्या में फंस जाता है, तो हमारा यह कर्तव्य बनता है कि हम बैंकर्स के साथ मिलकर समाधान निकालने और रिकवरी में उनकी मदद करें।\n\n*हमारा दृष्टिकोण:* हम सिर्फ फाइल लॉगिन करने में नहीं, बल्कि एक स्वच्छ और सुरक्षित पोर्टफोलियो बनाने में विश्वास रखते हैं। आइए, इसी जिम्मेदारी के साथ जुड़ें और मार्केट में अपनी एक मजबूत और विश्वसनीय पहचान बनाएं।`,
    opt_cibil: `📊 *Loan Plus – सिबिल (CIBIL) प्रॉब्लम्स और लोन पॉलिसी गाइडलाइंस* 📊\n\nहमारे पास 100 से भी ज्यादा बैंकों और NBFCs का प्लेटफार्म उपलब्ध है। सभी फाइनेंशियर्स की लोन पॉलिसी अलग-अलग होती है, और कई बैंक सिबिल की चुनिंदा समस्याओं पर भी लोन प्रदान करते हैं। काम शुरू करने से पहले हमें निम्नलिखित *महत्वपूर्ण नियमों* को समझना होगा:\n\n*🚫 इन फाइलों को नजरअंदाज करें:* यदि किसी ग्राहक ने हाल-फिलहाल में ही डिफॉल्ट किया है, वर्तमान में उसकी EMI रुक गई है, या वह लगातार डिफॉल्ट कर रहा है और फिर भी बड़े लोन की मांग कर रहा है—तो ऐसी फाइलों पर समय नहीं गंवाना चाहिए। ऐसे ग्राहकों के भविष्य में दोबारा डिफॉल्ट करने की संभावना बहुत अधिक होती है।\n\n🔍 *जांच और प्रोफाइलिंग:* खराब सिबिल वाले ग्राहकों की प्रोफाइल को हमें पूरी तरह जांच-परखकर ही बैंकों की पॉलिसी के अनुसार आगे बढ़ाना चाहिए।\n\n⚖️ *कागजात की मजबूती बनाम ब्याज दर (ROI):* यह एक सीधा नियम है—प्रॉपर्टी या बिजनेस के पेपर्स जितने मजबूत होंगे, ब्याज दर उतनी ही कम मिलेगी। पेपर्स में जितनी कमजोरी होगी, ब्याज दर उतनी ही अधिक होगी। हमें इसी कॉन्सेप्ट पर काम करना है।\n\n*💳 सेटल्ड या क्लोज्ड सिबिल इश्यूज:* ज्यादातर बैंक 1 से 2 साल पुराने क्रेडिट कार्ड या लोन के राइट-ऑफ/ओवरड्यू (पुराना सेटलमेंट), जो अब पूरी तरह क्लियर या भर दिए गए हैं, उन फाइलों पर अच्छे से विचार करती हैं।\n\n*🏦 NBFC का विकल्प:* यदि सिबिल में बड़ी समस्या या पुराना डिफॉल्ट है, तो ऐसी फाइलों पर सिर्फ कुछ चुनिंदा NBFCs ही काम करती हैं, लेकिन वहां ब्याज दरें काफी अधिक होती हैं।\n\n*🛑 अनसिक्यॉर लोन से बचें:* सिबिल डिफॉल्ट वाली फाइलों में *अनसिक्यॉर लोन (Personal/Business Loan)* पर बिल्कुल फोकस न करें। इससे सिर्फ आपका समय खराब होगा, क्योंकि कोई भी बैंक खराब सिबिल पर बिना सिक्योरिटी के लोन देने को तैयार नहीं होती।\n\n*निष्कर्ष:* हम कम सिबिल पर काम कर सकते हैं, बशर्ते मामला पुराना और सुलझा हुआ हो, या ग्राहक उचित मोर्टगेज (सिक्योरिटी) और हाई रेट ऑफ इंटरेस्ट देने के लिए तैयार हो। आइए, नियमों को समझकर एक सही और मजबूत पोर्टफोलियो बनाएं!`
  },
  en: {
    opt_about: `🤝 *Loan Plus – 15+ Years of Trust and Financial Partnership!* 🤝\n\nHello!\nWe are one of India's leading corporate loan consultancy firms. For more than *15+ years*, we have been providing the best financial solutions to businesses, shop owners, and individual clients nationwide.\n\n• Huge network of *50+ banks and NBFCs*.\n• More than *7,000+ satisfied clients*.\n• Over *100+ Crore Rupees* in loans successfully processed so far.\n\nOur main goal is to ensure you and your clients get loans with minimal documentation and the lowest interest rates. To learn more, explore our digital portfolio:\n🌐 *loan-plus.onrender.com*`,
    opt_comm: `🤝 *Grow with Loan Plus – Power of Large Volume, Maximum Commission!* 🤝\n\nHello!\nWe are a premier corporate loan broker operating PAN India. Due to our massive nationwide volume, large bank and NBFC targets are already met on our platform.\n\n*The biggest advantage of partnering with us:*\nYou do not need to individually meet targets in any bank. The volume of all partners is merged, directly unlocking the *Highest Slab* commission. That is why we offer our partners the best payout in the industry.\n\nBy joining us, you can earn excellent commissions on Home Loans, MSME, BG (Bank Guarantee), and LC (Letter of Credit).`,
    opt_timeline: `💼 *Loan Plus – Complete Transparency & Safe On-Time Payouts* 💼\n\nHello!\nWhen working with us, you enjoy complete transparency regarding your files and payouts. The process is clear and secure:\n\n📑 *Accurate Confirmation:* As soon as your file (without pendencies) is fully processed at any bank or NBFC, the login manager sends a direct confirmation to both you and us. You remain fully in the loop.\n\n💰 *Fast Bank Transfer:* Within *2 to 15 working days* of receiving confirmation, your commission is credited directly to your bank account.\n\nPartner with Loan Plus, where your business is transparent and your payouts are always safe and timely.`,
    opt_support: `🛠️ *Loan Plus – Your Convenience, Your Choice, Our Strong Support!* 🛠️\n\nHello!\nWhen partnering with us, you have *two easy ways* to process your loan files, which you can choose based on your preference:\n\n1. *Option 1 (Consultation & Guidance):* As soon as you receive a file, share the basic profile details with us. Our expert team will guide you on which bank or NBFC will approve the file most easily.\n\n2. *Option 2 (Direct Working):* If you prefer to handle the process yourself, we will provide you with the direct contact numbers of the managers at major banks and NBFCs. You can communicate with them directly based on your experience.\n\n*Our Promise:* Whichever option you choose, our backend team is always ready to assist with any queries or challenges during the process. Let's make your loan business simpler!`,
    opt_security: `🔒 *Loan Plus – 100% Data Security & Privacy Trust* 🔒\n\nHello!\nData security is critical in finance, and we respect your client's privacy. Your customer details will never be misused by other agents or managers. To maintain complete security, we offer *two transparent paths*:\n\n1. *Share Basic Profile Only:* You can hide customer names/personal IDs and share only the profile metrics (like income, CIBIL, loan amount) to find matching bank options.\n\n2. *Direct Manager Connectivity:* We provide direct bank manager contacts so you process files directly. No need to share customer data with us at all.\n\n*Our Commitment:* Your data and clients will always remain *100% secure and exclusively yours*. Grow your business with absolute peace of mind!`,
    opt_default: `🤝 *Loan Plus – Ethics, Reputation, and Long-Term Partnership* 🤝\n\nHello!\nTo build a successful and long journey in finance, the most important pillars are *'Ethics and Reputation'*. If a customer defaults immediately after loan disbursement, it becomes our collective responsibility. We believe in keeping both partners and bank relations safe to ensure long-term growth.\n\nTherefore, we must ensure:\n\n🔍 *Due Diligence:* Verify the borrower's intent and repayment capacity before processing files to prevent legal hassles.\n\n🚫 *Zero Tolerance:* In this digital era, all records are online. We must never encourage defaults. Our biggest asset is our name and market credibility.\n\n🤝 *Recovery Support:* If a genuine client faces temporary issues, we must work with bank managers to find recovery solutions.\n\n*Our Approach:* We focus on building a clean and safe portfolio rather than just logging files. Let's grow responsibly!`,
    opt_cibil: `📊 *Loan Plus – CIBIL Issues and Loan Policy Guidelines* 📊\n\nWith 100+ banks and NBFCs available on our platform, policies vary, and several financial institutions do offer loans on specific CIBIL issues. Let's review the *key rules* before starting:\n\n*🚫 Files to Avoid:* Avoid clients who recently defaulted, have ongoing unpaid EMIs, or are constantly defaulting but demanding big loans. The risk of default is extremely high.\n\n🔍 *Profiling:* Bad CIBIL profiles must be thoroughly evaluated and matched against specific bank policies before processing.\n\n⚖️ *Paper Strength vs ROI:* The rule is simple - stronger property/business papers result in lower ROI (interest rate). Weaker papers attract a higher ROI.\n\n*💳 Settled or Closed CIBIL Issues:* Most banks positively consider 1-2 years old settled or closed credit card write-offs/overdues once fully paid and cleared.\n\n*🏦 NBFC Options:* For major CIBIL issues or older defaults, only selected NBFCs operate, and they charge higher interest rates.\n\n*🛑 Avoid Unsecured Loans:* Do not focus on unsecured loans (Personal/Business) for bad CIBIL clients, as banks will not approve them without security.\n\n*Conclusion:* We can handle low CIBIL cases if they are old and settled, or if the client has good collateral and is ready for higher interest rates. Let's build a strong portfolio!`
  },
  gu: {
    opt_about: `🤝 *Loan Plus – 15+ વર્ષનો અતૂટ વિશ્વાસ અને નાણાકીય ભાગીદારી!* 🤝\n\nનમસ્તે!\nઅમે ભારતીય કોર્પોરેટ લોન કન્સલ્ટન્સી સેક્ટરમાં એક અગ્રણી નામ છીએ. છેલ્લા *15+ વર્ષોથી* અમે દેશના મુખ્ય વ્યવસાયો, દુકાનદારો અને વ્યક્તિગત ગ્રાહકોને શ્રેષ્ઠ નાણાકીય ઉકેલો પૂરા પાડી રહ્યા છીએ.\n\n• *50+ અગ્રણી બેંકો અને NBFCs* નું વિશાળ નેટવર્ક.\n• *7,000+ થી વધુ* સંતુષ્ટ ગ્રાહકો.\n• અત્યાર સુધીમાં *100+ કરોડ રૂપિયાથી વધુ* લોન સફળતાપૂર્વક મંજૂર (process) કરવામાં આવી છે.\n\nઅમારો મુખ્ય હેતુ એ છે કે તમને અને તમારા ગ્રાહકોને ઓછામાં ઓછા દસ્તાવેજો અને સૌથી ઓછા વ્યાજ દરે લોન મળી રહે. અમારા વિશે વધુ જાણવા માટે ડિજિટલ પોર્ટફોલિયો જુઓ:\n🌐 *loan-plus.onrender.com*`,
    opt_comm: `🤝 *Grow with Loan Plus – મોટા વોલ્યુમની તાકાત, સૌથી મોટું કમિશન!* 🤝\n\nનમસ્તે!\nઅમે અગ્રણી કોર્પોરેટ લોન બ્રોકર છીએ અને આખા ભારતમાં (PAN India) કાર્યરત છીએ. અમારું રાષ્ટ્રવ્યાપી બિઝનેસ વોલ્યુમ ઘણું મોટું હોવાને કારણે, બેંકો અને NBFCs ના મોટા ટાર્ગેટ અમારા પ્લેટફોર્મ પર પહેલેથી જ પૂરા થયેલા હોય છે.\n\n*અમારી સાથે જોડાવાનો સૌથી મોટો ફાયદો:*\nતમારે વ્યક્તિગત રીતે કોઈપણ બેંકમાં કોઈ ટાર્ગेत પૂરો કરવાની જરૂર નથી. બધા જ ભાગીદારોનું વોલ્યુમ એકસાથે ગણાય છે, જેના કારણે સીધું *સૌથી હાઇએસ્ટ સ્લેબ (Highest Slab)* કમિશન અનલોક થઈ જાય છે. આ જ कारण છે કે અમે અમારા પાર્ટનર્સને ઇન્ડસ્ટ્રીનું શ્રેષ્ઠ પેઆઉટ આપી શકીએ છીએ.\n\nઅમારો સાથ જોડાવા અને તમે હોમ લોન, MSME, BG (બેંક ગેરંટી) અને LC (લેટર ઓફ ક્રેડિટ) જેવા તમામ મોટા ફાઇનાન્સ પ્રોડક્ટ્સ પર ઉત્તમ કમિશન કમાઈ શકો છો.`,
    opt_timeline: `💼 *Loan Plus – સંપૂર્ણ પારદર્શિતા અને સમયસર સુરક્ષિત પેઆઉટ* 💼\n\nનમસ્તે!\nઅમારી સાથે કામ કરતી વખતે તમને ફાઇલ અને પેઆઉટ સંબંધિત સંપૂર્ણ પારદર્શિતા મળે છે. આ આખી પ્રક્રિયા અત્યંત સ્પષ્ટ અને સુરક્ષિત છે:\n\n📑 *ચોક્કસ કન્ફર્મેશન:* કોઈપણ બેંક અથવા NBFC માં જેવી તમારી ફાઇલ (કોઈપણ પેન્ડન્સી વગર) મંજૂર થાય છે, સંબંધિત લોગિન મેનેજર દ્વારા સીધો તમને અને અમને તરત જ કન્ફર્મેશન મેસેજ મોકલવામાં આવે છે. આખી પ્રક્રિયામાં તમે સંપૂર્ણ લૂપમાં (જોડાયેલા) રહો છો.\n\n💰 *ઝડપી બેંક ટ્રાન્સફર:* કન્ફર્મેશન મળ્યાના માત્ર *2 થી 15 વર્કિંગ ડેઝ (કાર્યકારી દિવસો)* ની અંદર તમારું નક્કી કરેલું કમિશન સીધું તમારા બેંક ખાતામાં જમા (credit) કરી દેવામાં આવે છે.\n\nLoan Plus સાથે જોડાઓ, જ્યાં તમારો વ્યવસાય સંપૂર્ણપણે સુરક્ષિત અને પેઆઉટ સમયસર રહે છે.`,
    opt_support: `🛠️ *Loan Plus – તમારી સુવિધા અને સ્વતંત્રતા, અમારો મજબૂત સપોર્ટ!* 🛠️\n\nનમસ્તે!\nઅમારી સાથે ભાગીદારીમાં કામ કરતી વખતે, તમારી ફાઇલોને પ્રોસેસ કરવા માટે તમારી પાસે *બે ઉત્તમ અને સરળ રસ્તાઓ* છે, જેને તમે તમારી સુવિધા મુજબ પસંદ કરી શકો છો:\n\n1. *વિકલ્પ 1 (માર્ગદર્શન અને પરામર્શ):* તમારી પાસે ફાઇલ આવે કે તરત જ તેની પ્રાથમિક માહિતી અમારી સાથે શેર કરો. અમારી નિષ્ણાત ટીમ તમને તરત જ ગાઈડ કરશે કે આ ફાઇલ કઈ બેંક કે NBFC માંથી સૌથી સરળતાથી મંજૂર થઈ શકે છે.\n\n2. *વિકલ્પ 2 (ડાયરેક્ટ વર્કિંગ):* જો તમે જાતે જ ફાઇલ પ્રોસેસ કરવા માંગતા હોવ, તો અમે તમને બધી અગ્રણી બેંકો અને NBFCs ના કનેક્ટેડ મેનેજરોના ડાયરેક્ટ નંબર્સ આપી દઈશું. તમે તમારા અનુભવના આધારે સીધી તેમની સાથે વાત કરીને પ્રક્રિયા આગળ વધારી શકો છો.\n\n*અમારું વચન:* તમે કોઈ પણ વિકલ્પ પસંદ કરો, પ્રક્રિયા દરમિયાન કોઈ પણ ક્વેરી કે સમસ્યાના ઉકેલ માટે અમારી બેકએન્ડ ટીમ હંમેશા તમારી સેવામાં તૈયાર રહેશે. ચાલો સાથે મળીને લોન બિઝનેસને વધુ સરળ અને નફાકારક બનાવીએ!`,
    opt_security: `🔒 *Loan Plus – 100% ડેટા સુરક્ષા અને ગુપ્તતાની ખાતરી* 🔒\n\nનમસ્તે!\nફાઇનાન્સ ક્ષેત્રમાં ડેટાની સુરક્ષા સૌથી મહત્વપૂર્ણ છે, અને અમે તમારા ગ્રાહકોની ગુપ્તતાનું પૂરેપૂરું સન્માન કરીએ છીએ. તમારા ગ્રાહકોની વિગતો અન્ય કોઈ એજન્ટ કે મેનેજર દ્વારા ક્યારેય દુરુપયોગ કરવામાં આવતી નથી. આ જ વિશ્વસનીયતા માટે અમે તમને *બે પારદર્શક રસ્તાઓ* આપીએ છીએ:\n\n1. *ફક્ત બેઝિક પ્રોફાઇલ શેર કરો:* તમે ગ્રાહકોના નામ કે પર્સનલ આઈડી છુપાવીને ફક્ત લોન પ્રોફાઇલ વિગતો (જેમ કે આવક, સિબિલ સ્કોર, લોન રકમ) શેર કરીને લોન ક્યાં મંજૂર થશે તે જાણી શકો છો.\n\n2. *ડાયરેક્ટ મેનેજર કનેક્ટિવિટી:* અમે તમને સીધા જ બેંક મેનેજરોના નંબર્સ આપી દઈશું. આ રીતે તમારે ગ્રાહકનો કોઈ પણ પર્સનલ ડેટા અમારી સાથે શેર કરવાની બિલકુલ જરૂર નથી રહેતી.\n\n*અમારો સંકલ્પ:* તમારો ડેટા અને તમારા ગ્રાહકો હંમેશા *100% સુરક્ષિત અને ફક્ત તમારા જ* રહેશે. Loan Plus સાથે જોડાઓ અને નિશ્ચિંત થઈને તમારો વ્યવસાય વધારો.`,
    opt_default: `🤝 *Loan Plus – નૈતિકતા, શાખ અને લાંબા ગાળાની ભાગીદારી* 🤝\n\nનમસ્તે!\nફાઇનાન્સ સેક્ટરમાં લાંબી સફળતા મેળવવા માટે સૌથી મહત્વપૂર્ણ સ્તંભ છે - *'નૈતિકતા અને શાખ'*. લોન મંજૂર થયા પછી જો ગ્રાહક તરત જ ડિફોલ્ટ કરે છે, તો નૈતિક રીતે તે આપણા સૌની જવાબદારી બને છે. જો બેંકો અને આપણો પોર્ટફોલિયો બંને સુરક્ષિત રહેશે, તો જ આપણે લાંબા સમય સુધી સાથે મળીને કામ કરી શકીશું.\n\nતેથી આ બાબતોનું ધ્યાન રાખવું જરૂરી છે:\n\n🔍 *ચોક્કસ તપાસ:* લોન પ્રોસેસ કરતા પહેલા ગ્રાહકની ચૂકવણી ક્ષમતા અને ઇરાદાની યોગ્ય તપાસ કરો જેથી ભવિષ્યમાં કોઈ કાનૂની મુશ્કેલીમાં ન ફસાઈએ.\n\n🚫 *ઝીરો ટોલરન્સ:* આજના ડિજિટલ યુગમાં બધો રેકોર્ડ ઓનલાઇન ઉપલબ્ધ હોય છે. આપણે ક્યારેય જાણીજોઈને ડિફોલ્ટ કે આવા કેસોને પ્રોત્સાહન આપવાનું નથી. આપણી અસલી સંપત્તિ આપણી બજાર ક્રેડિબિલિટી છે.\n\n🤝 *રિકવરીમાં સહયોગ:* જો કોઈ સાચો ગ્રાહક કોઈ મુશ્કેલીના કારણે હપ્તો ભરી નથી શકતો, તો આપણી ફરજ છે કે આપણે બેંક મેનેજરો સાથે મળીને રિકવરીમાં મદદ કરીએ.\n\n*અમારો દ્રષ્ટિકોણ:* અમે ફક્ત ફાઇલો લોગિન કરવામાં નહીં, પરંતુ એક ક્લીન અને સેફ પોર્ટફોલિયો બનાવવામાં માનીએ છીએ. જવાબદારીપૂર્વક વ્યવસાય વધારીએ!`,
    opt_cibil: `📊 *Loan Plus – સિબિલ (CIBIL) સમસ્યાઓ અને લોન પોલિસી માર્ગદર્શિકા* 📊\n\nઅમારી પાસે 100 થી વધુ બેંકો અને NBFCs ઉપલબ્ધ છે. દરેક બેંકની લોન નીતિ અલગ હોય છે, અને ઘણી બેંકો સિબિલ સ્કોરની પસંદગીની મુશ્કેલીઓ હોવા છતાં લોન પ્રદાન કરે છે. કામ શરૂ કરતા પહેલા આ *મહત્વના નિયમો* સમજવા જરૂરી છે:\n\n*🚫 આ ફાઇલો પર કામ ન કરવું:* જો કોઈ ગ્રાહકે હાલમાં જ ડિફોલ્ટ કર્યું હોય, હપ્તો બાકી હોય કે સતત ડિફોલ્ટ ચાલુ હોય તો પણ મોટી લોન જોઈતી હોય - તો આવી ફાઇલો પર સમય ન બગાડવો જોઈએ. આવા કેસોમાં ફરીથી ડિફોલ્ટની શક્યતા ઘણી વધારે હોય છે.\n\n🔍 *પ્રોફાઇલિંગ:* નબળા સિબિલ સ્કોર વાળા ગ્રાહકોની પ્રોફાઇલને સંપૂર્ણપણે તપાસીને બેંક પોલિસી મુજબ આગળ વધારવી.\n\n⚖️ *કાગળોની મજબૂતી વિરુદ્ધ વ્યાજ દર (ROI):* જો પ્રોપર્ટી કે બિઝનેસના કાગળો મજબૂત હશે તો વ્યાજ દર ઓછો મળશે. કાગળો નબળા હશે તો વ્યાજ દર થોડો વધારે રહેશે.\n\n*💳 સેટલ્ડ અથવા ક્લોઝ્ડ સિબિલ ઇશ્યૂઝ:* મોટાભાગની બેંકો 1-2 વર્ષ જૂના ક્રેડિટ કાર્ડ અથવા લોનના રાઇટ-ઓફ/સેટલમેન્ટ જે હવે ભરીને સંપૂર્ણ ચૂકતે કરી દેવામાં આવ્યા છે, તેવા કેસ પર ચોક્કસપણે વિચારણા કરે છે.\n\n*🏦 NBFC વિકલ્પ:* જો સિબિલમાં મોટી ખામી છે, તો ફક્ત કેટલીક પસંદગીની NBFCs જ કામ કરશે જ્યાં વ્યાજ દરો થોડા વધારે હોઈ શકે છે.\n\n*🛑 અનસિક્યોર્ડ લોનથી બચવું:* સિબિલ ડિફોલ્ટ વાળા ગ્રાહકો માટે *પર્સનલ કે બિઝનેસ લોન (Unsecured)* પર બિલકુલ ધ્યાન ન આપવું, કારણ કે કોઈ પણ બેંક આવી પ્રોફાઇલ પર જામીનગીરી વગર લોન આપતી નથી.\n\n*નિષ્કર્ષ:* આપણે ઓછા સિબિલ પર કામ કરી શકીએ છીએ, જો તે જૂનો અને ચૂકતે થયેલો મામલો હોય, અથવા ગ્રાહક મજબૂત મોર્ટગેજ (સિક્યોરિટી) અને થોડો ઊંચો વ્યાજ દર આપવા તૈયાર હોય.`
  },
  ta: {
    opt_about: `🤝 *Loan Plus – 15+ ஆண்டுகள் நம்பகமான நிதியியல் கூட்டாண்மை!* 🤝\n\nவணக்கம்!\nநாங்கள் இந்தியாவின் முன்னணி கார்ப்பரேட் கடன் ஆலோசனை நிறுவனங்களில் ஒன்றாகும். கடந்த *15+ ஆண்டுகளுக்கும் மேலாக* நாங்கள் நாடு முழுவதும் உள்ள வணிகங்கள், கடன் வாங்குபவர்கள் மற்றும் தனிப்பட்ட வாடிக்கையாளர்களுக்கு சிறந்த நிதியியல் தீர்வுகளை வழங்கி வருகிறோம்.\n\n• *50+ வங்கிகள் மற்றும் NBFCs* ஆகியவற்றின் மிகப்பெரிய கூட்டமைப்பு.\n• *7,000+க்கும் அதிகமான* திருப்தியான வாடிக்கையாளர்கள்.\n• இதுவரை *100+ கோடி ரூபாய்க்கும் அதிகமான* கடன்கள் வெற்றிகரமாக செயல்படுத்தப்பட்டுள்ளன.\n\nகுறைந்தபட்ச ஆவணங்கள் மற்றும் மிகக் குறைந்த வட்டி விகிதத்தில் வாடிக்கையாளர்கள் கடன் பெறுவதை உறுதி செய்வதே எங்களின் முக்கிய நோக்கம். எங்களைப் பற்றி மேலும் அறிய எங்கள் டிஜிட்டல் போர்ட்ஃபோலியோவை பார்வையிடவும்:\n🌐 *loan-plus.onrender.com*`,
    opt_comm: `🤝 *Grow with Loan Plus – பெரிய வணிகத்தின் வலிமை, மிகப்பெரிய கமிஷன்!* 🤝\n\nவணக்கம்!\nநாங்கள் அகில இந்திய அளவில் (PAN India) செயல்படும் ஒரு முன்னணி கார்ப்பரேட் கடன் தரகர் (broker) ஆவோம். எங்களின் மிகப்பெரிய வணிக அளவின் காரணமாக, வங்கிகள் மற்றும் NBFCs இன் பெரிய இலக்குகள் எங்கள் தளத்தில் ஏற்கனவே எட்டப்பட்டிருக்கும்.\n\n*எங்களுடன் இணைவதன் மிகப்பெரிய நன்மை:*\nநீங்கள் எந்தவொரு வங்கியிலும் தனிப்பட்ட முறையில் எந்த இலக்கையும் எட்ட வேண்டிய அவசியமில்லை. அனைத்து கூட்டாளர்களின் வணிக அளவும் ஒன்றிணைக்கப்பட்டு, நேரடியாக *மிக உயர்ந்த ஸ்லாப் (Highest Slab)* கமிஷன் வரம்பை உங்களுக்கு பெற்றுத் தரும். இதனால் தான் இத்துறையில் சிறந்த வருவாயை எங்கள் கூட்டாளர்களுக்கு வழங்குகிறோம்.\n\nஎங்களுடன் இணைவதன் மூலம் நீங்கள் வீட்டுக்கடன், MSME, BG (வங்கி உத்தரவாதம்) மற்றும் LC (கடன் கடிதம்) போன்ற அனைத்து பெரிய கடன் தயாரிப்புகளிலும் சிறந்த கமிஷன் பெறலாம்.`,
    opt_timeline: `💼 *Loan Plus – முழு வெளிப்படைத்தன்மை & பாதுகாப்பான சரியான நேர கமிஷன்* 💼\n\nவணக்கம்!\nஎங்களுடன் இணைந்து பணிபுரியும் போது உங்கள் ஆவணங்கள் மற்றும் கமிஷன் விநியோகம் தொடர்பாக முழு வெளிப்படைத்தன்மையை நீங்கள் பெறலாம். இதன் செயல்முறை மிகவும் தெளிவானது और பாதுகாப்பானது:\n\n📑 *துல்லியமான உறுதிப்படுத்தல்:* ஏதேனும் வங்கி அல்லது NBFC-யில் உங்கள் கோப்பு (எந்த நிலுவைகளும் இன்றி) முழுமையாக ஒப்புதல் பெறும்போது, சம்பந்தப்பட்ட மேலாளரால் உங்களுக்கும் எங்களுக்கும் உடனடியாக உறுதிப்படுத்தல் தகவல் வழங்கப்படும். இச்செயல்முறையில் நீங்கள் முழுமையாக இணைந்திருப்பீர்கள்.\n\n💰 *விரைவான வங்கி பரிமாற்றம்:* உறுதிப்படுத்தல் கிடைத்த *2 முதல் 15 வேலை நாட்களுக்குள்* உங்களின் கமிஷன் தொகை நேரடியாக உங்கள் வங்கி கணக்கில் வரவு வைக்கப்படும்.\n\nLoan Plus-உடன் இணையுங்கள், இங்கு உங்கள் வணிகம் முழு வெளிப்படைத்தன்மையுடனும் உங்களின் கमीஷன் பாதுகாப்பாகவும் இருக்கும்.`,
    opt_support: `🛠️ *Loan Plus – உங்களின் வசதி, எங்களின் வலுவான ஆதரவு!* 🛠️\n\nவணக்கம்!\nஎங்களுடன் கூட்டாளராக பணிபுரியும் போது, உங்கள் கடன் கோப்புகளை சமர்ப்பிக்க *இரண்டு எளிமையான வழிகள்* உள்ளன. உங்கள் வசதிக்கேற்ப நீங்கள் தேர்வு செய்யலாம்:\n\n1. *வழி 1 (ஆலோசனை மற்றும் வழிகாட்டுதல்):* உங்களிடம் ஏதேனும் கடன் கோப்பு வந்தவுடன், அதன் அடிப்படை விவரங்களை எங்களோடு பகிர்ந்து கொள்ளுங்கள். எங்கள் நிபுணர் குழு உங்களுக்கு உடனடியாக வழிகாட்டும்.\n\n2. *வழி 2 (நேரடி செயல்முறை):* நீங்களே நேரடியாக செயல்படுத்த விரும்பினால், அனைத்து முன்னணி வங்கிகள் மற்றும் NBFCs இன் சம்பந்தப்பட்ட மேலாளர்களின் நேரடி எண்களை நாங்கள் உங்களுக்கு வழங்குவோம். உங்கள் அனுபவத்தின் அடிப்படையில் நீங்களே நேரடியாக அவர்களோடு பேசலாம்.\n\n*எங்கள் வாக்குறுதி:* நீங்கள் எந்த வழியைத் தேர்ந்தெடுத்தாலும், எங்கள் குழு உங்களுக்கான ஆதரவை முழுமையாக வழங்கும். வாருங்கள், இணைந்து கடன் வணிகத்தை எளிமையாக்குவோம்!`,
    opt_security: `🔒 *Loan Plus – 100% தரவு பாதுகாப்பு மற்றும் தனியுரிமை உறுதி* 🔒\n\nவணக்கம்!\nநிதித்துறையில் வாடிக்கையாளர் தரவு பாதுகாப்பு மிகவும் முக்கியமானது. வாடிக்கையாளர்களின் தனியுரிமையை நாங்கள் மதிக்கிறோம். உங்கள் வாடிக்கையாளர்களின் விவரங்கள் பிற முகவர்களால் ஒருபோதும் தவறாகப் பயன்படுத்தப்பட மாட்டாது. இதற்கு நாங்கள் *இரண்டு வெளிப்படையான வழிகளை* வழங்குகிறோம்:\n\n1. *அடிப்படை விவரங்களை மட்டும் பகிரவும்:* வாடிக்கையாளர்களின் பெயர் அல்லது தனிப்பட்ட அடையாளங்களை மறைத்து, அவர்களின் வருமானம், சிபில், கடன் தொகை போன்ற அடிப்படை விவரங்களை மட்டும் பகிர்ந்து எந்த வங்கியில் ஒப்புதல் பெற முடியும் என்று தெரிந்து கொள்ளலாம்.\n\n2. *நேரடி மேலாளர் தொடர்பு:* நாங்கள் நேரடியாக வங்கி மேலாளர்களின் தொடர்புகளை உங்களுக்கு வழங்கி விடுவோம். இந்த முறையில் நீங்கள் வாடிக்கையாளர்களின் எந்தத் தரவையும் எங்களுடன் பகிர வேண்டியதில்லை.\n\n*எங்கள் உறுதிமொழி:* உங்கள் வாடிக்கையாளர் தரவுகள் எப்போதும் *100% பாதுகாப்பாகவும் உங்களுடையதாகவும் மட்டுமே* இருக்கும். Loan Plus உடன் இணைந்து பாதுகாப்பாக உங்கள் வணிகத்தை வளர்க்கவும்.`,
    opt_default: `🤝 *Loan Plus – நெறிமுறைகள், நற்பெயர் மற்றும் நீண்டகால கூட்டாண்மை* 🤝\n\nவணக்கம்!\nநிதித்துறையில் வெற்றிகரமாக நீண்ட காலம் நீடிக்க *'நெறிமுறைகளும் நற்பெயரும்'* மிக முக்கியமானவை. கடன் பெற்றவுடன் வாடிக்கையாளர் உடனடியாக தவணை தவறினால் (default), அது நமது கூட்டுப் பொறுப்பாகும். நமது வங்கிக் கூட்டணிகள் மற்றும் வாடிக்கையாளர் தரம் சிறப்பாக இருக்கும்போது தான் நாம் நீண்ட காலம் இணைந்து வளர முடியும்.\n\nஎனவே, நாம் பின்வரும் அம்சங்களில் கவனம் செலுத்த வேண்டும்:\n\n🔍 *துல்லியமான சரிபார்ப்பு:* கடனைச் செயல்படுத்துவதற்கு முன்பு வாடிக்கையாளரின் திருப்பிச் செலுத்தும் திறன் மற்றும் நோக்கத்தை முழுமையாகச் சரிபார்க்கவும்.\n\n🚫 *பூஜ்ஜிய சகிப்புத்தன்மை (Zero Tolerance):* இந்த டிஜிட்டல் யுகத்தில் அனைத்து பதிவுகளும் ஆன்லைனில் உள்ளன. நாம் ஒருபோதும் திட்டமிட்ட தவணைத் தவறுகளை ஊக்குவிக்கக் கூடாது. நமது நற்பெயரே நமது சொத்து.\n\n🤝 *மீட்பு ஆதரவு:* ஏதேனும் நியாயமான காரணத்தினால் வாடிக்கையாளர் சிரமப்பட்டால், மீட்பு தீர்வுகளைக் கண்டறிய நாம் வங்கி மேலாளர்களுடன் இணைந்து செயல்பட வேண்டும்.\n\n*எங்கள் அணுகுமுறை:* நாங்கள் கோப்புகளை சமர்ப்பிப்பதில் மட்டும் கவனம் செலுத்தாமல், சிறந்த மற்றும் பாதுகாப்பான போர்ட்ஃபோலியோவை உருவாக்குவதை நோக்கமாகக் கொண்டுள்ளோம். பொறுப்புடன் வணிகம் செய்வோம்!`,
    opt_cibil: `📊 *Loan Plus – சிபில் (CIBIL) சிக்கல்கள் மற்றும் கடன் கொள்கை வழிகாட்டுதல்கள்* 📊\n\nஎங்கள் தளத்தில் 100-க்கும் மேற்பட்ட வங்கிகள் மற்றும் NBFCs உள்ளன. ஒவ்வொன்றின் கொள்கைகளும் மாறுபடும். சிபிலில் குறிப்பிட்ட சிக்கல்கள் இருந்தாலும் சில வங்கிகள் கடன்களை வழங்குகின்றன. தொடங்குவதற்கு முன் இந்த *முக்கிய விதிகளையும்* கொள்கைகளையும் புரிந்து கொள்ள வேண்டும்:\n\n*🚫 தவிர்க்க வேண்டிய கோப்புகள்:* சமீபத்தில் தவணை தவறிக் கட்டியவர்கள், தற்போதைய EMI நிலுவையில் உள்ளவர்கள் அல்லது தொடர்ந்து தவணை தவறிக் கட்டிவிட்டு பெரிய கடன்களைக் கேட்பவர்களின் கோப்புகளைத் தவிர்க்கவும். இதில் மீண்டும் தவணை தவற வாய்ப்புகள் அதிகம்.\n\n🔍 *விவரங்களை ஆராய்தல்:* குறைந்த சிபில் மதிப்பெண் கொண்ட வாடிக்கையாளர்களின் கோப்புகளை வங்கிகளின் கொள்கைகளுக்கு ஏற்ப முழுமையாக ஆராய்ந்த பின்னரே சமர்ப்பிக்க வேண்டும்.\n\n⚖️ *ஆவணங்களின் பலம் மற்றும் वட்டி விகிதம்:* கொள்கை எளிமையானது - சொத்து அல்லது வணிக ஆவணங்கள் வலுவாக இருந்தால் வட்டி விகிதம் குறைவாக இருக்கும். ஆவணங்கள் பலவீனமாக இருந்தால் வட்டி விகிதம் அதிகமாக இருக்கும்.\n\n*💳 தீர்க்கப்பட்ட சிபில் சிக்கல்கள்:* 1 முதல் 2 ஆண்டுகள் பழமையான கிரெடிட் கார்டு அல்லது கடன் நிலுவைகள் தற்போது முழுமையாக செலுத்தப்பட்டு மூடப்பட்டிருந்தால், பெரும்பாலான வங்கிகள் அவற்றை பரிசீலிக்கும்.\n\n*🏦 NBFC வாய்ப்புகள்:* பெரிய சிபில் சிக்கல்கள் இருந்தால், சில குறிப்பிட்ட NBFCs மட்டுமே கடன் வழங்கும். ஆனால் அங்கு வட்டி விகிதம் அதிகமாக இருக்கும்.\n\n*🛑 பிணையில்லாக் கடன்களைத் தவிர்க்கவும் (Unsecured Loans):* குறைந்த சிபில் உள்ள வாடிக்கையாளர்களுக்கு பிணையில்லாக் கடன்களை (தனிநபர்/வணிகக் கடன்) தவிர்க்கவும். ஏனெனில் பிணை இல்லாமல் வங்கிகள் இவர்களுக்கு ஒப்புதல் அளிக்காது.\n\n*முடிவு:* பழமையான தீர்க்கப்பட்ட சிக்கல்கள் அல்லது தகுந்த பிணை ஆவணங்கள் மற்றும் கூடுதல் வட்டி விகிதம் செலுத்த தயாராக இருக்கும் குறைந்த சிபில் வாடிக்கையாளர் கோப்புகளை நாம் கையாளலாம். நெறிமுறையான வலுவான போர்ட்ஃபோலியோவை உருவாக்குவோம்!`
  }
};

async function buildLoanPlusFlow() {
  console.log("[Migration] Fetching existing welcome flows for account...");
  
  // Cleanup old welcome flow for this account to avoid trigger collisions
  const { data: oldFlows } = await supabase.from('flows')
    .select('id')
    .eq('account_id', targetAccountId)
    .eq('trigger_type', 'first_inbound_message');

  if (oldFlows && oldFlows.length > 0) {
    console.log(`[Migration] Cleaning up ${oldFlows.length} old flows...`);
    for (const f of oldFlows) {
      await supabase.from('flow_nodes').delete().eq('flow_id', f.id);
      await supabase.from('flows').delete().eq('id', f.id);
    }
  }

  const flowId = uuid();
  console.log(`[Migration] Creating Welcome Flow: ${flowId}`);

  const { error: flowErr } = await supabase.from('flows').insert({
    id: flowId,
    account_id: targetAccountId,
    user_id: targetUserId,
    name: 'Loan Plus Welcome Flow',
    description: 'Welcome flow for Loan Plus (Hindi, English, Gujarati, Tamil) with dynamic date scheduling and question responder',
    status: 'active',
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    entry_node_id: 'start',
    fallback_policy: 'reprompt',
    execution_count: 0
  });

  if (flowErr) {
    console.error("Failed to insert flow:", flowErr.message);
    return;
  }

  const nodes = [];

  // Start Node
  nodes.push({
    id: uuid(), flow_id: flowId, node_key: 'start', node_type: 'start',
    config: { next_node_key: 'select_language' }, position_x: 0, position_y: 0
  });

  // Language Selection List Node
  nodes.push({
    id: uuid(), flow_id: flowId, node_key: 'select_language', node_type: 'send_list',
    config: {
      text: "आगे बढ़ने के लिए कृपया भाषा चुनें / Please select your language to proceed:",
      button_label: "भाषा / Language",
      sections: [{
        title: "Available Languages",
        rows: [
          { reply_id: 'lang_hi', title: 'हिंदी (Hindi)', description: 'हिंदी में आगे बढ़ें', next_node_key: 'meet_date_hi' },
          { reply_id: 'lang_gu', title: 'ગુજરાતી (Gujarati)', description: 'ગુજરાતીમાં આગળ વધો', next_node_key: 'meet_date_gu' },
          { reply_id: 'lang_en', title: 'English', description: 'Proceed in English', next_node_key: 'meet_date_en' },
          { reply_id: 'lang_ta', title: 'தமிழ் (Tamil)', description: 'தமிழில் தொடரவும்', next_node_key: 'meet_date_ta' }
        ]
      }]
    },
    position_x: 200, position_y: 0
  });

  // Define Language branches
  const langs = ['hi', 'en', 'gu', 'ta'];
  
  langs.forEach((lang, lIdx) => {
    const yOffset = lIdx * 400;
    const t = texts[lang];

    // Node 3: Date Selection Node (dynamic buttons rendered using vars)
    nodes.push({
      id: uuid(), flow_id: flowId, node_key: `meet_date_${lang}`, node_type: 'send_list',
      config: {
        text: t.meet_ask,
        button_label: lang === 'hi' ? 'तारीख चुनें' : lang === 'en' ? 'Select Date' : lang === 'gu' ? 'તારીખ પસંદ કરો' : 'தேதியைத் தேர்ந்தெடுக்கவும்',
        sections: [{
          title: lang === 'hi' ? 'तारीखें' : lang === 'en' ? 'Dates' : lang === 'gu' ? 'તારીખો' : 'தேதிகள்',
          rows: [
            { reply_id: `date1_${lang}`, title: `{{vars.date_1_${lang}}}`, next_node_key: `meet_time_${lang}` },
            { reply_id: `date2_${lang}`, title: `{{vars.date_2_${lang}}}`, next_node_key: `meet_time_${lang}` },
            { reply_id: `date3_${lang}`, title: `{{vars.date_3_${lang}}}`, next_node_key: `meet_time_${lang}` },
            { reply_id: `other_${lang}`, title: lang === 'hi' ? 'अन्य तारीख' : lang === 'en' ? 'Other Date' : lang === 'gu' ? 'અન્ય તારીખ' : 'வேறு தேதி', next_node_key: `meet_time_${lang}` }
          ]
        }]
      },
      position_x: 400, position_y: yOffset
    });

    // Node 4: Time Slot Node
    nodes.push({
      id: uuid(), flow_id: flowId, node_key: `meet_time_${lang}`, node_type: 'send_buttons',
      config: {
        text: t.time_ask,
        buttons: [
          { reply_id: `time1_${lang}`, title: "10 AM - 1 PM", next_node_key: `ask_address_${lang}` },
          { reply_id: `time2_${lang}`, title: "1 PM - 4 PM", next_node_key: `ask_address_${lang}` },
          { reply_id: `time3_${lang}`, title: "4 PM - 7 PM", next_node_key: `ask_address_${lang}` }
        ]
      },
      position_x: 600, position_y: yOffset
    });

    // Node 5: Collect Address Node
    nodes.push({
      id: uuid(), flow_id: flowId, node_key: `ask_address_${lang}`, node_type: 'collect_input',
      config: {
        prompt_text: t.addr_ask,
        var_key: 'office_address',
        validation: 'any',
        next_node_key: `ask_info_pref_${lang}`
      },
      position_x: 800, position_y: yOffset
    });

    // Node 6: Ask Info Preference Buttons
    nodes.push({
      id: uuid(), flow_id: flowId, node_key: `ask_info_pref_${lang}`, node_type: 'send_buttons',
      config: {
        text: t.pref_ask,
        buttons: [
          { reply_id: `pref_no_${lang}`, title: lang === 'hi' ? 'नहीं' : lang === 'en' ? 'No' : lang === 'gu' ? 'ના' : 'இல்லை', next_node_key: `end_flow_${lang}` },
          { reply_id: `pref_yes_${lang}`, title: lang === 'hi' ? 'हाँ, जानकारी बताएं' : lang === 'en' ? 'Yes, tell me info' : lang === 'gu' ? 'હા, માહિતી જણાવો' : 'ஆம், தகவல் தேவை', next_node_key: `show_info_menu_${lang}` }
        ]
      },
      position_x: 1000, position_y: yOffset
    });

    // Node 7: End Flow message (No info needed)
    nodes.push({
      id: uuid(), flow_id: flowId, node_key: `end_flow_${lang}`, node_type: 'send_message',
      config: {
        text: t.pref_no_msg,
        next_node_key: `terminate_${lang}`
      },
      position_x: 1200, position_y: yOffset
    });

    // Terminate Node
    nodes.push({
      id: uuid(), flow_id: flowId, node_key: `terminate_${lang}`, node_type: 'end',
      config: {},
      position_x: 1400, position_y: yOffset
    });

    // Node 8: Show Info Menu
    nodes.push({
      id: uuid(), flow_id: flowId, node_key: `show_info_menu_${lang}`, node_type: 'send_list',
      config: {
        text: t.info_prompt,
        button_label: lang === 'hi' ? 'सवाल चुनें' : lang === 'en' ? 'Select Question' : lang === 'gu' ? 'પ્રશ્ન પસંદ કરો' : 'கேள்வியைத் தேர்ந்தெடு',
        sections: [{
          title: lang === 'hi' ? 'जानकारी सूची' : lang === 'en' ? 'Information List' : lang === 'gu' ? 'માહિતી સૂચિ' : 'தகவல் பட்டியல்',
          rows: menuOptions[lang].map(opt => ({
            reply_id: `${opt.id}_${lang}`,
            title: opt.title,
            description: opt.desc,
            next_node_key: `ans_${opt.id}_${lang}`
          }))
        }]
      },
      position_x: 1200, position_y: yOffset + 200
    });

    // Node 9: Info Answers
    const optIds = ['opt_about', 'opt_comm', 'opt_timeline', 'opt_support', 'opt_security', 'opt_default', 'opt_cibil'];
    optIds.forEach((optId, oIdx) => {
      nodes.push({
        id: uuid(), flow_id: flowId, node_key: `ans_${optId}_${lang}`, node_type: 'send_buttons',
        config: {
          text: answers[lang][optId],
          buttons: [
            { reply_id: `back_menu_${lang}`, title: t.opt_back, next_node_key: `show_info_menu_${lang}` },
            { reply_id: `end_chat_${lang}`, title: lang === 'hi' ? 'मीटिंग में मिलेंगे' : lang === 'en' ? 'See you in meeting' : lang === 'gu' ? 'મીટિંગમાં મળીએ' : 'சந்திப்போம்', next_node_key: `end_flow_${lang}` }
          ]
        },
        position_x: 1400, position_y: yOffset + 200 + (oIdx * 150)
      });
    });
  });

  console.log(`[Migration] Inserting ${nodes.length} nodes into flow_nodes...`);
  const { error: nodeErr } = await supabase.from('flow_nodes').insert(nodes);
  if (nodeErr) {
    console.error("Failed to insert flow nodes:", nodeErr.message);
    return;
  }

  console.log("[Migration] Loan Plus welcome flow created successfully!");
}

buildLoanPlusFlow().then(() => process.exit(0)).catch(console.error);
