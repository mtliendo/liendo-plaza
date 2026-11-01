import * as SecureStore from "expo-secure-store";

const TOKEN = "lp.session";
const FAMILY = "lp.family";

export async function saveSession(token: string) {
  await SecureStore.setItemAsync(TOKEN, token);
}

export async function getSession() {
  return SecureStore.getItemAsync(TOKEN);
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(TOKEN);
}

export async function saveFamilyToken(token: string) {
  await SecureStore.setItemAsync(FAMILY, token);
}

export async function getFamilyToken() {
  return SecureStore.getItemAsync(FAMILY);
}
