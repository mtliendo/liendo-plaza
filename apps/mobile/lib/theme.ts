import type { TextStyle, ViewStyle } from "react-native";

export const colors = {
  paper: "#FAF6EF",
  paper2: "#F7F0E4",
  paper3: "#EFE4D2",
  ink: "#3A2418",
  ink2: "#5C3A24",
  muted: "#7A5840",
  accent: "#8C4A22",
  accentInk: "#FAF6EF",
  error: "#8C2F1F",
  rule: "#E4D6C4",
};

export const type = {
  display: "Fraunces",
  displayItalic: "Fraunces-Italic",
  body: "Figtree",
};

export const tap = 64;

export const screen: ViewStyle = {
  flexGrow: 1,
  backgroundColor: colors.paper,
  padding: 24,
  gap: 16,
};

export const h1: TextStyle = {
  fontFamily: type.display,
  fontSize: 32,
  color: colors.ink,
};

export const accentLabel: TextStyle = {
  fontFamily: type.displayItalic,
  fontSize: 16,
  color: colors.ink2,
  fontStyle: "italic",
};

export const h2: TextStyle = {
  fontFamily: type.display,
  fontSize: 24,
  color: colors.ink,
};

export const body: TextStyle = {
  fontFamily: type.body,
  fontSize: 16,
  color: colors.ink2,
};

export const muted: TextStyle = {
  fontSize: 15,
  color: colors.muted,
};

export const input: TextStyle = {
  backgroundColor: colors.paper2,
  color: colors.ink,
  padding: 16,
  minHeight: tap,
};

export const btn: ViewStyle = {
  backgroundColor: colors.accent,
  paddingVertical: 18,
  paddingHorizontal: 20,
  minHeight: tap,
  justifyContent: "center",
};

export const btnLabel: TextStyle = {
  color: colors.accentInk,
  textAlign: "center",
  fontSize: 17,
};

export const row: ViewStyle = {
  backgroundColor: colors.paper2,
  padding: 16,
  minHeight: tap,
  borderLeftWidth: 5,
  borderLeftColor: colors.accent,
  justifyContent: "center",
  gap: 4,
};

export function personEdge(color: string): ViewStyle {
  return {
    backgroundColor: colors.paper2,
    borderLeftWidth: 5,
    borderLeftColor: color,
    padding: 16,
    minHeight: tap,
    justifyContent: "center",
  };
}
