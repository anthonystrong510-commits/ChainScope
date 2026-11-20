# Security Specification & Payload-First Verification

## 1. Data Invariants
1. **PII Isolation**: `userPrivate/{userId}` holds user email and is strictly readable/writable only when `request.auth.uid == userId`. Public `userProfiles/{userId}` holds no email or PII.
2. **Account Solvency & Initial Balance**: On `userProfiles/{userId}` creation, `solBalance` must equal `10.0` SOL, `uid` must match `request.auth.uid`, and `createdAt == request.time`.
3. **Immutable Coin Authorship**: `memeCoins/{coinId}` must set `creatorUid == request.auth.uid` on creation, and `creatorUid` + `createdAt` + `totalSupply` can never be mutated afterwards.
4. **Atomic Trade Ledger**: Every `memeCoins/{coinId}/trades/{tradeId}` write requires `traderUid == request.auth.uid`, `coinId` matching path, `createdAt == request.time`, and `existsAfter(/databases/$(database)/documents/memeCoins/$(coinId))` so trades only exist on valid coins. Trades are immutable (update/delete denied).
5. **Owner-Scoped Holdings**: `userProfiles/{userId}/holdings/{coinId}` can only be read, created, or updated by `request.auth.uid == userId`, with `ownerUid == userId` and `existsAfter(/databases/$(database)/documents/memeCoins/$(coinId))`.
6. **Verified Auth Gate**: All writes require `request.auth != null && request.auth.token.email_verified == true`.

## 2. Adversarial "Dirty Dozen" Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Read `memeCoins` or create a coin with `auth: null`.
2. **Unverified Email Write**: Create `userProfiles/{uid}` with `email_verified: false`.
3. **Identity Spoofing on Coin Launch**: Create `memeCoins/c1` with `creatorUid: "other_user"`.
4. **Infinite SOL Minting on Signup**: Create `userProfiles/{uid}` with `solBalance: 9999999`.
5. **Shadow Ghost Field Injection**: Create `memeCoins/c1` with extra field `isAdminVerified: true`.
6. **PII Leak Attempt**: Read `userPrivate/victimUid` as `attackerUid`.
7. **Unauthorized Profile Update**: Update `userProfiles/victimUid` as `attackerUid`.
8. **Immutable Creator Tampering**: Update `memeCoins/c1` to change `creatorUid` or `name` via trade update.
9. **Fake Timestamp Injection**: Create `memeCoins/c1` with client-supplied past timestamp instead of `request.time`.
10. **ID Poisoning Attack**: Create `memeCoins/bad$id!with*spaces` or a >128 char ID.
11. **Trade Tampering / Deletion**: Update or delete an existing `memeCoins/c1/trades/t1` record.
12. **Orphaned Holding Write**: Create `userProfiles/{uid}/holdings/nonexistent_coin` when `memeCoins/nonexistent_coin` does not exist.
