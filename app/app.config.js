// Dev builds may talk to a LAN backend over plain HTTP. Production builds (APP_ENV=production) must use HTTPS only.
const production = process.env.APP_ENV === 'production';

export default {
  expo: {
    name: 'RevoV',
    slug: 'revov',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    android: { package: 'com.satev.revov' },
    plugins: [
      'expo-secure-store',
      ['expo-build-properties', { android: { usesCleartextTraffic: !production } }],
    ],
  },
};
