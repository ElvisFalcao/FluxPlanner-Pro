/**
 * data.js — Country configs, platform data, asset weights
 */

// Countries with TikTok Ads availability & recommended splits
const COUNTRY_DATA = {
  NG: {
    name: 'Nigeria',
    flag: '🇳🇬',
    tiktokAllowed: true,
    splits: {
      TikTok:    40,
      Instagram: 30,
      YouTube:   20,
      Facebook:  10,
    },
  },
  ZA: {
    name: 'South Africa',
    flag: '🇿🇦',
    tiktokAllowed: true,
    splits: {
      TikTok:    35,
      Instagram: 30,
      YouTube:   20,
      Facebook:  15,
    },
  },
  KE: {
    name: 'Kenya',
    flag: '🇰🇪',
    tiktokAllowed: true,
    splits: {
      TikTok:    30,
      Instagram: 25,
      YouTube:   30,
      Facebook:  15,
    },
  },
  GH: {
    name: 'Ghana',
    flag: '🇬🇭',
    tiktokAllowed: false,
    tiktokNote: 'TikTok Ads are not available in Ghana. Budget redistributed to other platforms.',
    splits: {
      TikTok:    0,
      Instagram: 35,
      YouTube:   35,
      Facebook:  30,
    },
  },
  AO: {
    name: 'Angola',
    flag: '🇦🇴',
    tiktokAllowed: false,
    tiktokNote: 'TikTok Ads are not available in Angola. Budget redistributed to other platforms.',
    // Facebook skews more popular than Instagram in Angola.
    splits: {
      TikTok:    0,
      Instagram: 30,
      YouTube:   30,
      Facebook:  40,
    },
  },
  ZM: {
    name: 'Zambia',
    flag: '🇿🇲',
    tiktokAllowed: false,
    tiktokNote: 'TikTok Ads are not available in Zambia. Budget redistributed to other platforms.',
    splits: {
      TikTok:    0,
      Instagram: 35,
      YouTube:   35,
      Facebook:  30,
    },
  },
  GB: {
    name: 'United Kingdom',
    flag: '🇬🇧',
    tiktokAllowed: true,
    splits: {
      TikTok:    25,
      Instagram: 35,
      YouTube:   25,
      Facebook:  15,
    },
  },
  US: {
    name: 'United States',
    flag: '🇺🇸',
    tiktokAllowed: true,
    splits: {
      TikTok:    30,
      Instagram: 30,
      YouTube:   25,
      Facebook:  15,
    },
  },
  CUSTOM: {
    name: 'Custom',
    flag: '🌍',
    tiktokAllowed: true,
    splits: {
      TikTok:    25,
      Instagram: 25,
      YouTube:   25,
      Facebook:  25,
    },
  },
};

// Platforms config
const PLATFORMS = [
  { id: 'TikTok',    label: 'TikTok',    cssClass: 'tiktok',    icon: '🎵' },
  { id: 'Instagram', label: 'Instagram', cssClass: 'instagram', icon: '📸' },
  { id: 'YouTube',   label: 'YouTube',   cssClass: 'youtube',   icon: '▶️' },
  { id: 'Facebook',  label: 'Facebook',  cssClass: 'facebook',  icon: '👤' },
];

// Asset type weights (how much budget each type gets relative to Video)
const ASSET_WEIGHTS = {
  Video:            1.0,
  'Animated Static': 0.65,
  Static:           0.45,
};

// Which platforms each asset type can run on. A post is created ONCE and
// automatically fanned out to these platforms (intersected with the platforms
// available in the selected country). Video runs everywhere; an animated clip
// works as short-form video on TikTok/IG/FB but not long-form YouTube; a plain
// static image only fits the feed placements (Instagram / Facebook).
const ASSET_PLATFORM_ELIGIBILITY = {
  Video:             ['TikTok', 'Instagram', 'YouTube', 'Facebook'],
  'Animated Static': ['TikTok', 'Instagram', 'Facebook'],
  Static:            ['Instagram', 'Facebook'],
};

// Default ad objective per platform — assigned automatically to each generated
// line item (no manual selection needed).
const PLATFORM_OBJECTIVES = {
  TikTok:    'Video Views',
  YouTube:   'Video Views',
  Instagram: 'Engagement',
  Facebook:  'Reach',
};

// Days of week helper
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Default durations per platform (days)
const DEFAULT_DURATIONS = {
  TikTok:    7,
  YouTube:   7,
  Instagram: 5,
  Facebook:  5,
};
