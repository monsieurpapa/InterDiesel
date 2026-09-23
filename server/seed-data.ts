// Demo catalog for Bukavu. References marked "ID-" are internal codes; the OEM-style
// numbers are illustrative and must be checked against the real stock before use.
import type { Fitment } from '../shared/types';

const BOXER150: Fitment = { brand: 'Bajaj', model: 'Boxer BM150', years: '2014-2024' };
const BOXER100: Fitment = { brand: 'Bajaj', model: 'Boxer BM100', years: '2012-2022' };
const TVSHLX: Fitment = { brand: 'TVS', model: 'HLX 125', years: '2016-2024' };
const TVSSTAR: Fitment = { brand: 'TVS', model: 'Star City+', years: '2015-2024' };
const HAOJUE: Fitment = { brand: 'Haojue', model: 'HJ125-8', years: '2013-2023' };
const HAOJUE150: Fitment = { brand: 'Haojue', model: 'DK150', years: '2017-2024' };
const LC79: Fitment = { brand: 'Toyota', model: 'Land Cruiser HZJ79 (1HZ)', years: '1999-2024' };
const HILUX: Fitment = { brand: 'Toyota', model: 'Hilux (2KD/1KD)', years: '2005-2015' };
const HIACE: Fitment = { brand: 'Toyota', model: 'Hiace (2L/3L/5L)', years: '1995-2010' };
const COROLLA: Fitment = { brand: 'Toyota', model: 'Corolla (1ZZ/2ZR)', years: '2002-2018' };
const PRADO: Fitment = { brand: 'Toyota', model: 'Land Cruiser Prado (1KD)', years: '2003-2015' };

export interface SeedProduct {
  ref: string;
  name: string;
  brand: string;
  category: string;
  fits: Fitment[];
  cost: number;
  price: number;
  unit?: string;
  barcode?: string;
  popularity: number; // relative sales weight for the demo history
  initial: number; // initial stock per store
}

export const CATEGORIES = [
  'Moteur',
  'Freinage',
  'Transmission',
  'Électricité',
  'Filtres',
  'Pneus et chambres',
  'Lubrifiants',
  'Suspension',
  'Carrosserie et accessoires',
];

export const PRODUCTS: SeedProduct[] = [
  // --- Motos: transmission
  { ref: 'BX-KIT-428H', name: 'Kit chaîne 428H + pignons 14/41', brand: 'Bajaj', category: 'Transmission', fits: [BOXER150, BOXER100], cost: 9.5, price: 15, popularity: 9, initial: 30, barcode: '8901234500011' },
  { ref: 'TVS-KIT-428', name: 'Kit chaîne 428 + pignons 14/43', brand: 'TVS', category: 'Transmission', fits: [TVSHLX, TVSSTAR], cost: 10, price: 16, popularity: 6, initial: 20, barcode: '8901234500028' },
  { ref: 'HJ-KIT-428', name: 'Kit chaîne 428 + pignons 15/42', brand: 'Haojue', category: 'Transmission', fits: [HAOJUE, HAOJUE150], cost: 9, price: 14, popularity: 5, initial: 18 },
  { ref: 'BX-CLT-PLT', name: "Disques d'embrayage (jeu de 5)", brand: 'Bajaj', category: 'Transmission', fits: [BOXER150, BOXER100], cost: 4, price: 7, popularity: 7, initial: 25 },
  { ref: 'TVS-CLT-PLT', name: "Disques d'embrayage (jeu de 4)", brand: 'TVS', category: 'Transmission', fits: [TVSHLX], cost: 4.2, price: 7.5, popularity: 4, initial: 15 },
  { ref: 'BX-CBL-CLT', name: "Câble d'embrayage", brand: 'Bajaj', category: 'Transmission', fits: [BOXER150, BOXER100], cost: 1.2, price: 2.5, popularity: 8, initial: 40 },
  { ref: 'ID-CBL-ACC', name: "Câble d'accélérateur universel", brand: 'Générique', category: 'Transmission', fits: [BOXER150, TVSHLX, HAOJUE], cost: 1, price: 2, popularity: 7, initial: 40 },
  // --- Motos: freinage
  { ref: 'BX-MCH-AR', name: 'Mâchoires de frein arrière', brand: 'Bajaj', category: 'Freinage', fits: [BOXER150, BOXER100], cost: 1.8, price: 3.5, popularity: 10, initial: 50, barcode: '8901234500035' },
  { ref: 'BX-MCH-AV', name: 'Mâchoires de frein avant', brand: 'Bajaj', category: 'Freinage', fits: [BOXER150, BOXER100], cost: 1.8, price: 3.5, popularity: 8, initial: 45 },
  { ref: 'TVS-MCH', name: 'Mâchoires de frein (paire)', brand: 'TVS', category: 'Freinage', fits: [TVSHLX, TVSSTAR], cost: 2, price: 4, popularity: 6, initial: 30 },
  { ref: 'HJ-PLQ-AV', name: 'Plaquettes de frein avant', brand: 'Haojue', category: 'Freinage', fits: [HAOJUE150], cost: 2.5, price: 5, popularity: 4, initial: 20 },
  { ref: 'BX-CBL-FRN', name: 'Câble de frein avant', brand: 'Bajaj', category: 'Freinage', fits: [BOXER150, BOXER100], cost: 1.1, price: 2.5, popularity: 5, initial: 30 },
  // --- Motos: moteur
  { ref: 'BX-PST-150', name: 'Kit piston 150 cc (std)', brand: 'Bajaj', category: 'Moteur', fits: [BOXER150], cost: 9, price: 16, popularity: 4, initial: 12 },
  { ref: 'BX-SEG-150', name: 'Segments de piston 150 cc', brand: 'Bajaj', category: 'Moteur', fits: [BOXER150], cost: 3, price: 6, popularity: 5, initial: 20 },
  { ref: 'TVS-PST-125', name: 'Kit piston 125 cc (std)', brand: 'TVS', category: 'Moteur', fits: [TVSHLX], cost: 8.5, price: 15, popularity: 3, initial: 10 },
  { ref: 'BX-CARB', name: 'Carburateur complet', brand: 'Bajaj', category: 'Moteur', fits: [BOXER150, BOXER100], cost: 11, price: 19, popularity: 3, initial: 10 },
  { ref: 'BX-JNT-MOT', name: 'Pochette de joints moteur', brand: 'Bajaj', category: 'Moteur', fits: [BOXER150], cost: 2.5, price: 5, popularity: 5, initial: 20 },
  { ref: 'NGK-C7HSA', name: "Bougie d'allumage NGK C7HSA", brand: 'NGK', category: 'Électricité', fits: [TVSHLX, TVSSTAR, HAOJUE], cost: 1.1, price: 2.5, popularity: 9, initial: 60, barcode: '087295140050' },
  { ref: 'NGK-D8EA', name: "Bougie d'allumage NGK D8EA", brand: 'NGK', category: 'Électricité', fits: [BOXER150, BOXER100], cost: 1.2, price: 2.5, popularity: 10, initial: 60, barcode: '087295145055' },
  { ref: 'BX-SOUP', name: 'Jeu de soupapes adm./éch.', brand: 'Bajaj', category: 'Moteur', fits: [BOXER150], cost: 4, price: 8, popularity: 2, initial: 10 },
  // --- Motos: électricité
  { ref: 'ID-BAT-12V5', name: 'Batterie moto 12V 5Ah', brand: 'Leoch', category: 'Électricité', fits: [BOXER150, TVSHLX, HAOJUE], cost: 9, price: 15, popularity: 5, initial: 15 },
  { ref: 'ID-AMP-H4M', name: 'Ampoule phare 12V 35/35W', brand: 'Générique', category: 'Électricité', fits: [BOXER150, TVSHLX, HAOJUE], cost: 0.6, price: 1.5, popularity: 8, initial: 80 },
  { ref: 'BX-CDI', name: 'Boîtier CDI', brand: 'Bajaj', category: 'Électricité', fits: [BOXER150, BOXER100], cost: 5, price: 10, popularity: 3, initial: 10 },
  { ref: 'BX-REG', name: 'Régulateur redresseur', brand: 'Bajaj', category: 'Électricité', fits: [BOXER150], cost: 4, price: 8, popularity: 3, initial: 10 },
  { ref: 'ID-CLG-UNI', name: 'Clignotant universel', brand: 'Générique', category: 'Électricité', fits: [BOXER150, TVSHLX, HAOJUE], cost: 0.8, price: 2, popularity: 5, initial: 40 },
  // --- Motos: pneus
  { ref: 'PN-275-17', name: 'Pneu 2.75-17 avant', brand: 'Kingstone', category: 'Pneus et chambres', fits: [BOXER150, TVSHLX, HAOJUE], cost: 12, price: 19, popularity: 6, initial: 20 },
  { ref: 'PN-300-17', name: 'Pneu 3.00-17 arrière', brand: 'Kingstone', category: 'Pneus et chambres', fits: [BOXER150, TVSHLX, HAOJUE], cost: 14, price: 22, popularity: 7, initial: 20 },
  { ref: 'PN-300-18', name: 'Pneu 3.00-18 arrière', brand: 'Kingstone', category: 'Pneus et chambres', fits: [BOXER150, HAOJUE150], cost: 15, price: 23, popularity: 5, initial: 15 },
  { ref: 'CH-300-17', name: 'Chambre à air 3.00-17', brand: 'Kingstone', category: 'Pneus et chambres', fits: [BOXER150, TVSHLX, HAOJUE], cost: 2.2, price: 4, popularity: 9, initial: 50 },
  { ref: 'CH-275-17', name: 'Chambre à air 2.75-17', brand: 'Kingstone', category: 'Pneus et chambres', fits: [BOXER150, TVSHLX, HAOJUE], cost: 2, price: 3.5, popularity: 7, initial: 50 },
  // --- Motos: suspension / accessoires
  { ref: 'BX-AMO-AR', name: 'Amortisseurs arrière (paire)', brand: 'Bajaj', category: 'Suspension', fits: [BOXER150, BOXER100], cost: 14, price: 24, popularity: 3, initial: 8 },
  { ref: 'BX-ROUL-6301', name: 'Roulement de roue 6301', brand: 'SKF', category: 'Suspension', fits: [BOXER150, BOXER100, TVSHLX], cost: 1.3, price: 3, popularity: 7, initial: 50, barcode: '7316577000014' },
  { ref: 'BX-RETRO', name: 'Rétroviseurs (paire)', brand: 'Générique', category: 'Carrosserie et accessoires', fits: [BOXER150, TVSHLX, HAOJUE], cost: 1.5, price: 3.5, popularity: 5, initial: 30 },
  { ref: 'BX-POIG', name: 'Poignées de guidon (paire)', brand: 'Générique', category: 'Carrosserie et accessoires', fits: [BOXER150, TVSHLX, HAOJUE], cost: 0.8, price: 2, popularity: 4, initial: 30 },
  { ref: 'BX-SELLE', name: 'Housse de selle renforcée', brand: 'Générique', category: 'Carrosserie et accessoires', fits: [BOXER150, BOXER100], cost: 2.5, price: 5, popularity: 3, initial: 20 },
  { ref: 'ID-CASQUE', name: 'Casque intégral', brand: 'Générique', category: 'Carrosserie et accessoires', fits: [], cost: 9, price: 16, popularity: 2, initial: 10 },
  // --- Lubrifiants
  { ref: 'LUB-4T-2050-1', name: 'Huile moteur 4T 20W-50 (1 L)', brand: 'Total Hi-Perf', category: 'Lubrifiants', fits: [BOXER150, TVSHLX, HAOJUE], cost: 3.8, price: 6, unit: 'litre', popularity: 12, initial: 80, barcode: '3425901025663' },
  { ref: 'LUB-4T-2050-1S', name: 'Huile moteur 4T 20W-50 (1 L)', brand: 'Shell Advance', category: 'Lubrifiants', fits: [BOXER150, TVSHLX, HAOJUE], cost: 4, price: 6.5, unit: 'litre', popularity: 8, initial: 60 },
  { ref: 'LUB-15W40-5', name: 'Huile moteur diesel 15W-40 (5 L)', brand: 'Total Rubia', category: 'Lubrifiants', fits: [LC79, HILUX, HIACE, PRADO], cost: 18, price: 27, unit: 'bidon', popularity: 6, initial: 25 },
  { ref: 'LUB-2050-4', name: 'Huile moteur 20W-50 (4 L)', brand: 'Mobil Super', category: 'Lubrifiants', fits: [COROLLA, HIACE], cost: 14, price: 21, unit: 'bidon', popularity: 5, initial: 25 },
  { ref: 'LUB-ATF-1', name: 'Huile boîte ATF Dexron III (1 L)', brand: 'Total', category: 'Lubrifiants', fits: [COROLLA, PRADO], cost: 4, price: 7, unit: 'litre', popularity: 3, initial: 20 },
  { ref: 'LUB-GEAR-1', name: 'Huile de pont 85W-140 (1 L)', brand: 'Total', category: 'Lubrifiants', fits: [LC79, HILUX], cost: 4.5, price: 7.5, unit: 'litre', popularity: 3, initial: 20 },
  { ref: 'LUB-DOT3', name: 'Liquide de frein DOT 3 (500 ml)', brand: 'Total', category: 'Lubrifiants', fits: [LC79, HILUX, HIACE, COROLLA, PRADO], cost: 2.5, price: 4.5, popularity: 4, initial: 25 },
  { ref: 'LUB-GRAISSE', name: 'Graisse multi-usage (500 g)', brand: 'Total', category: 'Lubrifiants', fits: [], cost: 2, price: 4, popularity: 4, initial: 25 },
  // --- Toyota: filtres
  { ref: '15601-44011', name: 'Filtre à huile', brand: 'Toyota', category: 'Filtres', fits: [HIACE, LC79], cost: 4.5, price: 8, popularity: 7, initial: 30, barcode: '4987707100011' },
  { ref: '90915-YZZE1', name: 'Filtre à huile', brand: 'Toyota', category: 'Filtres', fits: [COROLLA], cost: 3.5, price: 6.5, popularity: 5, initial: 25 },
  { ref: '90915-YZZD4', name: 'Filtre à huile', brand: 'Toyota', category: 'Filtres', fits: [HILUX, PRADO], cost: 4.5, price: 8, popularity: 5, initial: 25 },
  { ref: '23390-64480', name: 'Filtre à gasoil', brand: 'Toyota', category: 'Filtres', fits: [HIACE, LC79, HILUX], cost: 7, price: 12, popularity: 5, initial: 20 },
  { ref: '17801-54180', name: 'Filtre à air', brand: 'Toyota', category: 'Filtres', fits: [HIACE], cost: 8, price: 14, popularity: 3, initial: 12 },
  { ref: '17801-0C010', name: 'Filtre à air', brand: 'Toyota', category: 'Filtres', fits: [HILUX], cost: 9, price: 15, popularity: 3, initial: 12 },
  { ref: 'BX-FLT-HUI', name: 'Filtre à huile moto (crépine)', brand: 'Bajaj', category: 'Filtres', fits: [BOXER150, BOXER100], cost: 0.7, price: 1.5, popularity: 6, initial: 50 },
  { ref: 'BX-FLT-AIR', name: 'Filtre à air moto', brand: 'Bajaj', category: 'Filtres', fits: [BOXER150], cost: 1.5, price: 3, popularity: 5, initial: 30 },
  // --- Toyota: freinage
  { ref: '04465-0K240', name: 'Plaquettes de frein avant', brand: 'Toyota', category: 'Freinage', fits: [HILUX], cost: 16, price: 26, popularity: 4, initial: 12 },
  { ref: '04465-60320', name: 'Plaquettes de frein avant', brand: 'Toyota', category: 'Freinage', fits: [LC79, PRADO], cost: 18, price: 29, popularity: 3, initial: 10 },
  { ref: '04495-26010', name: 'Mâchoires de frein arrière', brand: 'Toyota', category: 'Freinage', fits: [HIACE], cost: 15, price: 25, popularity: 3, initial: 10 },
  { ref: '04465-12610', name: 'Plaquettes de frein avant', brand: 'Toyota', category: 'Freinage', fits: [COROLLA], cost: 12, price: 20, popularity: 3, initial: 10 },
  // --- Toyota: transmission / moteur / suspension
  { ref: 'KIT-EMB-HIACE', name: "Kit d'embrayage (disque + mécanisme + butée)", brand: 'Exedy', category: 'Transmission', fits: [HIACE], cost: 85, price: 125, popularity: 1, initial: 4 },
  { ref: 'KIT-EMB-HILUX', name: "Kit d'embrayage (disque + mécanisme + butée)", brand: 'Exedy', category: 'Transmission', fits: [HILUX], cost: 110, price: 160, popularity: 1, initial: 3 },
  { ref: 'CRD-1HZ', name: 'Courroie alternateur', brand: 'Gates', category: 'Moteur', fits: [LC79], cost: 6, price: 11, popularity: 3, initial: 12 },
  { ref: '16100-59275', name: 'Pompe à eau', brand: 'Aisin', category: 'Moteur', fits: [LC79], cost: 45, price: 70, popularity: 1, initial: 4 },
  { ref: 'INJ-2KD', name: 'Joint injecteur (lot de 4)', brand: 'Toyota', category: 'Moteur', fits: [HILUX, PRADO], cost: 3, price: 6, popularity: 2, initial: 15 },
  { ref: '48510-TOY-AV', name: 'Amortisseur avant', brand: 'KYB', category: 'Suspension', fits: [HILUX], cost: 35, price: 55, popularity: 1, initial: 6 },
  { ref: 'ROT-TOY-HZJ', name: 'Rotule de direction', brand: '555', category: 'Suspension', fits: [LC79], cost: 14, price: 24, popularity: 2, initial: 8 },
  { ref: 'SIL-HIACE', name: 'Silentbloc de bras (lot de 2)', brand: 'Toyota', category: 'Suspension', fits: [HIACE], cost: 6, price: 11, popularity: 2, initial: 10 },
  { ref: 'BAT-12V70', name: 'Batterie 12V 70Ah', brand: 'Chloride Exide', category: 'Électricité', fits: [HILUX, COROLLA, HIACE], cost: 70, price: 98, popularity: 1, initial: 5 },
  { ref: 'AMP-H4-TOY', name: 'Ampoule H4 12V 60/55W', brand: 'Philips', category: 'Électricité', fits: [HILUX, HIACE, COROLLA, LC79], cost: 1.8, price: 3.5, popularity: 4, initial: 30 },
  { ref: 'BAL-ESS-22', name: "Balais d'essuie-glace 22\" (paire)", brand: 'Bosch', category: 'Carrosserie et accessoires', fits: [HILUX, COROLLA, PRADO], cost: 5, price: 9, popularity: 2, initial: 12 },
];

export const CUSTOMERS = [
  { name: 'Garage Umoja (Nguba)', phone: '+243991234501', limit: 500 },
  { name: 'Garage Mwangaza', phone: '+243971234502', limit: 400 },
  { name: 'Bahati Mushagalusa (mécanicien)', phone: '+243851234503', limit: 150 },
  { name: 'Espoir Cirimwami (taxi-moto)', phone: '+243991234504', limit: 60 },
  { name: 'Furaha Bisimwa (taxi-moto)', phone: '+243971234505', limit: 60 },
  { name: 'Transport Kivu Express', phone: '+243811234506', limit: 800 },
  { name: 'Justin Balagizi', phone: '+243991234507', limit: 100 },
  { name: 'Moto Service Kadutu', phone: '+243971234508', limit: 300 },
  { name: 'Clovis Murhula', phone: '+243851234509', limit: 80 },
  { name: 'Garage Tujenge (Bagira)', phone: '+243991234510', limit: 400 },
  { name: 'Aimée Nabintu', phone: '+243971234511', limit: 50 },
  { name: 'Coopérative des taxi-motos de Bagira', phone: '+243811234512', limit: 600 },
];

export const SUPPLIERS = [
  { name: 'Kivu Motors Import', phone: '+243991230001', city: 'Bukavu' },
  { name: 'Great Lakes Auto Parts', phone: '+256701230002', city: 'Kampala' },
  { name: 'Rwanda Moto Spares', phone: '+250781230003', city: 'Kigali' },
  { name: 'Lubrifiants Est-Congo', phone: '+243971230004', city: 'Goma' },
];
