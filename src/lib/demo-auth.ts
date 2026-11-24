type DemoSession = { email: string; name: string; role: string; startedAt: string };
export function isDemoCredentials(_email: string, _password: string) { return false; }
export function getDemoSession(): DemoSession | null { return null; }
export function hasDemoSession() { return false; }
export function endDemoSession() {}
export function onDemoAuthStateChange(_callback: (event: "SIGNED_IN" | "SIGNED_OUT") => void) { return () => {}; }
