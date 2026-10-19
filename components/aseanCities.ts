export type City = {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  countryCode: string; // ISO 3166-1 alpha-2
  // Stable geocoder ID (Open-Meteo / GeoNames) used by the Eco Watch backend.
  placeId: string;
};

export const ASEAN_CITIES: City[] = [
  { id: "sg", name: "Singapore", country: "Singapore", lat: 1.3521, lon: 103.8198, countryCode: "SG", placeId: "open-meteo:1880252" },

  { id: "kl", name: "Kuala Lumpur", country: "Malaysia", lat: 3.139, lon: 101.6869, countryCode: "MY", placeId: "open-meteo:1735161" },
  { id: "pg", name: "George Town (Penang)", country: "Malaysia", lat: 5.4141, lon: 100.3288, countryCode: "MY", placeId: "open-meteo:1735106" },
  { id: "jb", name: "Johor Bahru", country: "Malaysia", lat: 1.4927, lon: 103.7414, countryCode: "MY", placeId: "open-meteo:1732752" },
  { id: "kk", name: "Kota Kinabalu", country: "Malaysia", lat: 5.9804, lon: 116.0735, countryCode: "MY", placeId: "open-meteo:1733432" },
  { id: "kch", name: "Kuching", country: "Malaysia", lat: 1.5533, lon: 110.3592, countryCode: "MY", placeId: "open-meteo:1735634" },

  { id: "jkt", name: "Jakarta", country: "Indonesia", lat: -6.2088, lon: 106.8456, countryCode: "ID", placeId: "open-meteo:1642911" },
  { id: "sby", name: "Surabaya", country: "Indonesia", lat: -7.2575, lon: 112.7521, countryCode: "ID", placeId: "open-meteo:1625822" },
  { id: "bdg", name: "Bandung", country: "Indonesia", lat: -6.9175, lon: 107.6191, countryCode: "ID", placeId: "open-meteo:1650357" },
  { id: "mdn", name: "Medan", country: "Indonesia", lat: 3.5952, lon: 98.6722, countryCode: "ID", placeId: "open-meteo:1214520" },
  { id: "dps", name: "Denpasar (Bali)", country: "Indonesia", lat: -8.6705, lon: 115.2126, countryCode: "ID", placeId: "open-meteo:1645528" },
  { id: "mks", name: "Makassar", country: "Indonesia", lat: -5.1477, lon: 119.4327, countryCode: "ID", placeId: "open-meteo:1622786" },

  { id: "bkk", name: "Bangkok", country: "Thailand", lat: 13.7563, lon: 100.5018, countryCode: "TH", placeId: "open-meteo:1609350" },
  { id: "cnx", name: "Chiang Mai", country: "Thailand", lat: 18.7883, lon: 98.9853, countryCode: "TH", placeId: "open-meteo:1153671" },
  { id: "hkt", name: "Phuket", country: "Thailand", lat: 7.8804, lon: 98.3923, countryCode: "TH", placeId: "open-meteo:1151254" },

  { id: "han", name: "Hanoi", country: "Vietnam", lat: 21.0278, lon: 105.8342, countryCode: "VN", placeId: "open-meteo:1581130" },
  { id: "sgn", name: "Ho Chi Minh City", country: "Vietnam", lat: 10.8231, lon: 106.6297, countryCode: "VN", placeId: "open-meteo:1566083" },
  { id: "dad", name: "Da Nang", country: "Vietnam", lat: 16.0544, lon: 108.2022, countryCode: "VN", placeId: "open-meteo:1583992" },

  { id: "mnl", name: "Manila", country: "Philippines", lat: 14.5995, lon: 120.9842, countryCode: "PH", placeId: "open-meteo:1701668" },
  { id: "qc", name: "Quezon City", country: "Philippines", lat: 14.676, lon: 121.0437, countryCode: "PH", placeId: "open-meteo:1692192" },
  { id: "ceb", name: "Cebu City", country: "Philippines", lat: 10.3157, lon: 123.8854, countryCode: "PH", placeId: "open-meteo:1717512" },
  { id: "dvo", name: "Davao City", country: "Philippines", lat: 7.1907, lon: 125.4553, countryCode: "PH", placeId: "open-meteo:1715348" },

  { id: "ygn", name: "Yangon", country: "Myanmar", lat: 16.8409, lon: 96.1735, countryCode: "MM", placeId: "open-meteo:1298824" },
  { id: "mdl", name: "Mandalay", country: "Myanmar", lat: 21.9588, lon: 96.0891, countryCode: "MM", placeId: "open-meteo:1311874" },
  { id: "npt", name: "Naypyidaw", country: "Myanmar", lat: 19.7633, lon: 96.0785, countryCode: "MM", placeId: "open-meteo:6611854" },

  { id: "pnh", name: "Phnom Penh", country: "Cambodia", lat: 11.5564, lon: 104.9282, countryCode: "KH", placeId: "open-meteo:1821306" },
  { id: "rep", name: "Siem Reap", country: "Cambodia", lat: 13.3671, lon: 103.8448, countryCode: "KH", placeId: "open-meteo:1822214" },

  { id: "vte", name: "Vientiane", country: "Laos", lat: 17.9757, lon: 102.6331, countryCode: "LA", placeId: "open-meteo:1651944" },
  { id: "lpq", name: "Luang Prabang", country: "Laos", lat: 19.8856, lon: 102.1347, countryCode: "LA", placeId: "open-meteo:1655559" },

  { id: "bwn", name: "Bandar Seri Begawan", country: "Brunei", lat: 4.9031, lon: 114.9398, countryCode: "BN", placeId: "open-meteo:1820906" },

  { id: "dil", name: "Dili", country: "Timor-Leste", lat: -8.5569, lon: 125.5603, countryCode: "TL", placeId: "open-meteo:1645457" },

  { id: "bjs", name: "Beijing", country: "China", lat: 39.9075, lon: 116.3972, countryCode: "CN", placeId: "open-meteo:1816670" },
  { id: "sha", name: "Shanghai", country: "China", lat: 31.2222, lon: 121.4581, countryCode: "CN", placeId: "open-meteo:1796236" },
  { id: "can", name: "Guangzhou", country: "China", lat: 23.1167, lon: 113.25, countryCode: "CN", placeId: "open-meteo:1809858" },
  { id: "szx", name: "Shenzhen", country: "China", lat: 22.5455, lon: 114.0683, countryCode: "CN", placeId: "open-meteo:1795565" },
  { id: "ctu", name: "Chengdu", country: "China", lat: 30.6667, lon: 104.0667, countryCode: "CN", placeId: "open-meteo:1815286" },

  { id: "hkg", name: "Hong Kong", country: "Hong Kong", lat: 22.2783, lon: 114.1747, countryCode: "HK", placeId: "open-meteo:1819729" },

  { id: "del", name: "New Delhi", country: "India", lat: 28.6358, lon: 77.2245, countryCode: "IN", placeId: "open-meteo:1261481" },
  { id: "bom", name: "Mumbai", country: "India", lat: 19.0728, lon: 72.8826, countryCode: "IN", placeId: "open-meteo:1275339" },
  { id: "blr", name: "Bengaluru", country: "India", lat: 12.9719, lon: 77.5937, countryCode: "IN", placeId: "open-meteo:1277333" },
  { id: "maa", name: "Chennai", country: "India", lat: 13.0878, lon: 80.2785, countryCode: "IN", placeId: "open-meteo:1264527" },
  { id: "ccu", name: "Kolkata", country: "India", lat: 22.5626, lon: 88.363, countryCode: "IN", placeId: "open-meteo:1275004" },
];