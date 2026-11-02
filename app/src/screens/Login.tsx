import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api';
import { useSession } from '../session';
import { Banner, Btn, Card, ExclamationTriangleIcon, Logo, Screen, Title } from '../ui';
import { c } from '../theme';

export default function Login() {
  const { signIn } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try { await signIn(username.trim(), password); }
    catch (e) { setError(e instanceof ApiError ? (e.isNetwork ? 'Cannot reach the server. Check the connection.' : e.message) : 'Sign-in failed'); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <View style={{ marginTop: 24 }}><Logo /></View>
      <Title sub="Use the account issued for this machine.">Sign in</Title>
      <Card>
        <Text style={s.label}>Username</Text>
        <TextInput style={s.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} />
        <Text style={s.label}>Password</Text>
        <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" onSubmitEditing={submit} />
      </Card>
      {error ? <Banner tone="error" icon={<ExclamationTriangleIcon size={22} color={c.red} />} title={error} /> : null}
      <Btn label="Sign in" onPress={submit} busy={busy} disabled={!username || !password} />
    </Screen>
  );
}

const s = StyleSheet.create({
  label: { color: c.muted, fontSize: 14, marginBottom: 6, marginTop: 6 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 17, color: c.navy, backgroundColor: c.bg },
});
