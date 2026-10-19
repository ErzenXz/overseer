export type DiffLine = ["+" | "-" | " " | "@", string];

export const AUTH_DIFF: DiffLine[] = [
  ["@", "@@ -84,9 +84,12 @@ func TestSessionExpiry(t *testing.T) {"],
  ["-", "\tstore := NewStore()"],
  ["+", "\tclock := newFakeClock()"],
  ["+", "\tstore := NewStore(WithClock(clock))"],
  [" ", "\tid := store.Create(user)"],
  ["-", "\ttime.Sleep(10 * time.Millisecond)"],
  ["+", "\tclock.Advance(ttl + time.Second)"],
  [" ", "\tif store.Valid(id) {"],
  [" ", '\t\tt.Fatal("expired session still valid")'],
];
