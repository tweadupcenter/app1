// Dictionnaires FR (par défaut) et AR (RTL). Les clés absentes en arabe retombent sur le français.
export type Locale = 'fr' | 'ar';

const fr = {
  'app.name': 'Tweadup Immo 360',
  'nav.dashboard': 'Tableau de bord', 'nav.projects': 'Projets', 'nav.lots': 'Lots', 'nav.prospects': 'Prospects',
  'nav.agenda': 'Agenda et tâches', 'nav.media': 'Médias et exports', 'nav.team': 'Équipe', 'nav.settings': 'Paramètres',
  'nav.logout': 'Se déconnecter', 'nav.public': 'Présentation publique',
  'status.available': 'Disponible', 'status.option': 'Option temporaire', 'status.reserved': 'Réservé', 'status.sold': 'Vendu', 'status.unavailable': 'Indisponible',
  'type.studio': 'Studio', 'type.apartment': 'Appartement', 'type.duplex': 'Duplex', 'type.villa': 'Villa', 'type.commercial': 'Local commercial',
  'type.office': 'Bureau', 'type.parking': 'Parking', 'type.storage': 'Cellier',
  'stage.new': 'Nouveau', 'stage.contacted': 'Contacté', 'stage.visit_planned': 'Visite prévue', 'stage.interested': 'Intéressé',
  'stage.option': 'Option', 'stage.reserved': 'Réservé', 'stage.sold': 'Vendu', 'stage.lost': 'Perdu',
  'role.admin': 'Administrateur', 'role.project_manager': 'Chef de projet', 'role.sales': 'Commercial', 'role.viewer': 'Lecteur interne',
  'source.website': 'Site web', 'source.whatsapp': 'WhatsApp', 'source.phone': 'Téléphone', 'source.walk_in': 'Visite spontanée',
  'source.referral': 'Recommandation', 'source.portal': 'Portail immobilier', 'source.social': 'Réseaux sociaux', 'source.other': 'Autre',
  'amenity.pool': 'Piscine', 'amenity.garden': 'Jardin', 'amenity.sport': 'Sport', 'amenity.parking': 'Parking', 'amenity.playground': 'Aire de jeux', 'amenity.other': 'Autre',
  'prov.documented': 'Documenté', 'prov.estimated': 'Estimé', 'prov.proposed': 'Proposé', 'prov.validated': 'Validé',
  'visit.overview': 'Vue générale', 'visit.fullscreen': 'Plein écran', 'visit.recenter': 'Recentrer', 'visit.hideAbove': 'Masquer les étages supérieurs',
  'visit.section': 'Coupe', 'visit.statusColors': 'Couleurs de disponibilité', 'visit.favorites': 'Favoris', 'visit.compare': 'Comparer',
  'visit.minimap': 'Mini-plan', 'visit.tour': 'Parcours', 'visit.allFloors': 'Tous les étages', 'visit.building': 'Bâtiment', 'visit.floor': 'Étage',
  'visit.fallback': 'La 3D n’est pas disponible sur cet appareil : affichage des plans et images.',
  'lot.rooms': 'Pièces', 'lot.bedrooms': 'Chambres', 'lot.surface': 'Surface', 'lot.terrace': 'Terrasse', 'lot.garden': 'Jardin',
  'lot.price': 'Prix', 'lot.priceOnRequest': 'Prix sur demande', 'lot.orientation': 'Orientation', 'lot.floor': 'Étage', 'lot.building': 'Bâtiment',
  'lot.features': 'Caractéristiques', 'lot.open': 'Voir la fiche', 'lot.pdf': 'Fiche PDF', 'lot.addFavorite': 'Ajouter aux favoris', 'lot.removeFavorite': 'Retirer des favoris',
  'public.requestInfo': 'Demander des informations', 'public.bookVisit': 'Prendre rendez-vous', 'public.whatsapp': 'Contacter par WhatsApp',
  'public.name': 'Nom complet', 'public.email': 'E-mail', 'public.phone': 'Téléphone', 'public.message': 'Message', 'public.preferredAt': 'Créneau souhaité',
  'public.consent': 'J’accepte d’être recontacté(e) au sujet de ce projet. Mes données sont utilisées uniquement pour traiter ma demande.',
  'public.send': 'Envoyer', 'public.sent': 'Demande envoyée. Un conseiller vous recontactera. Aucun logement n’est réservé par cette demande.',
  'public.fictional': 'Projet fictif de démonstration — aucune donnée réelle.', 'public.lots': 'Logements', 'public.filters': 'Filtres',
  'public.compareMax': 'Comparaison limitée à 3 lots.', 'public.plans': 'Plans et images',
  'common.save': 'Enregistrer', 'common.cancel': 'Annuler', 'common.delete': 'Supprimer', 'common.edit': 'Modifier', 'common.create': 'Créer',
  'common.search': 'Rechercher', 'common.all': 'Tous', 'common.loading': 'Chargement…', 'common.empty': 'Aucun élément.', 'common.error': 'Une erreur est survenue.',
  'common.close': 'Fermer', 'common.back': 'Retour', 'common.language': 'Langue',
};

export type DictKey = keyof typeof fr;

const ar: Partial<Record<DictKey, string>> = {
  'nav.dashboard': 'لوحة القيادة', 'nav.projects': 'المشاريع', 'nav.lots': 'الوحدات', 'nav.prospects': 'العملاء المحتملون',
  'nav.agenda': 'المواعيد والمهام', 'nav.media': 'الوسائط والتصدير', 'nav.team': 'الفريق', 'nav.settings': 'الإعدادات', 'nav.logout': 'تسجيل الخروج',
  'nav.public': 'العرض العام',
  'status.available': 'متاح', 'status.option': 'خيار مؤقت', 'status.reserved': 'محجوز', 'status.sold': 'مباع', 'status.unavailable': 'غير متاح',
  'type.studio': 'استوديو', 'type.apartment': 'شقة', 'type.duplex': 'دوبلكس', 'type.villa': 'فيلا', 'type.commercial': 'محل تجاري', 'type.office': 'مكتب',
  'type.parking': 'موقف سيارات', 'type.storage': 'مخزن',
  'stage.new': 'جديد', 'stage.contacted': 'تم الاتصال', 'stage.visit_planned': 'زيارة مبرمجة', 'stage.interested': 'مهتم', 'stage.option': 'خيار',
  'stage.reserved': 'محجوز', 'stage.sold': 'مباع', 'stage.lost': 'ضائع',
  'role.admin': 'مسؤول', 'role.project_manager': 'مدير المشروع', 'role.sales': 'مستشار مبيعات', 'role.viewer': 'قارئ داخلي',
  'amenity.pool': 'المسبح', 'amenity.garden': 'الحديقة', 'amenity.sport': 'الرياضة', 'amenity.parking': 'موقف السيارات', 'amenity.playground': 'ملعب الأطفال',
  'visit.overview': 'نظرة عامة', 'visit.fullscreen': 'ملء الشاشة', 'visit.recenter': 'إعادة التمركز', 'visit.hideAbove': 'إخفاء الطوابق العليا',
  'visit.section': 'مقطع', 'visit.statusColors': 'ألوان التوفر', 'visit.favorites': 'المفضلة', 'visit.compare': 'مقارنة', 'visit.minimap': 'خريطة مصغرة',
  'visit.tour': 'جولة', 'visit.allFloors': 'كل الطوابق', 'visit.building': 'العمارة', 'visit.floor': 'الطابق',
  'visit.fallback': 'العرض ثلاثي الأبعاد غير متاح على هذا الجهاز: عرض المخططات والصور.',
  'lot.rooms': 'الغرف', 'lot.bedrooms': 'غرف النوم', 'lot.surface': 'المساحة', 'lot.terrace': 'الشرفة', 'lot.garden': 'الحديقة', 'lot.price': 'السعر',
  'lot.priceOnRequest': 'السعر عند الطلب', 'lot.orientation': 'الاتجاه', 'lot.floor': 'الطابق', 'lot.building': 'العمارة', 'lot.features': 'المميزات',
  'lot.open': 'عرض البطاقة', 'lot.pdf': 'بطاقة PDF', 'lot.addFavorite': 'إضافة إلى المفضلة', 'lot.removeFavorite': 'إزالة من المفضلة',
  'public.requestInfo': 'طلب معلومات', 'public.bookVisit': 'حجز موعد', 'public.whatsapp': 'تواصل عبر واتساب', 'public.name': 'الاسم الكامل',
  'public.email': 'البريد الإلكتروني', 'public.phone': 'الهاتف', 'public.message': 'الرسالة', 'public.preferredAt': 'الموعد المفضل',
  'public.consent': 'أوافق على أن يتم التواصل معي بخصوص هذا المشروع. تُستخدم بياناتي فقط لمعالجة طلبي.', 'public.send': 'إرسال',
  'public.sent': 'تم إرسال الطلب. سيتصل بك مستشار. هذا الطلب لا يحجز أي وحدة.', 'public.fictional': 'مشروع وهمي للعرض — لا توجد بيانات حقيقية.',
  'public.lots': 'الوحدات', 'public.filters': 'التصفية', 'public.compareMax': 'المقارنة محدودة بثلاث وحدات.', 'public.plans': 'المخططات والصور',
  'common.save': 'حفظ', 'common.cancel': 'إلغاء', 'common.delete': 'حذف', 'common.edit': 'تعديل', 'common.create': 'إنشاء', 'common.search': 'بحث',
  'common.all': 'الكل', 'common.loading': 'جارٍ التحميل…', 'common.empty': 'لا توجد عناصر.', 'common.error': 'حدث خطأ.', 'common.close': 'إغلاق',
  'common.back': 'رجوع', 'common.language': 'اللغة',
};

export function translator(locale: Locale) {
  return (key: DictKey | string): string => (locale === 'ar' ? (ar as Record<string, string>)[key] : undefined) ?? (fr as Record<string, string>)[key] ?? key;
}

export const dir = (l: Locale) => (l === 'ar' ? 'rtl' : 'ltr');
export const DICT_FR = fr;
export const DICT_AR = ar;
