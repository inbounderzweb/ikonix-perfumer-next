import { Schema, type InferSchemaType } from "mongoose";
import { ObjectId, defineModel, int } from "./_shared";

// ── User (customers and staff) ─────────────────────────────────────────────
const googleIdentitySchema = new Schema(
  {
    sub: { type: String, required: true }, // Google subject id
    email: String,
    emailVerified: { type: Boolean, default: false },
    linkedAt: { type: Date, default: Date.now },
    lastUsedAt: Date,
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    mobile: { type: String, match: /^\+[1-9][0-9]{7,14}$/ }, // E.164
    mobileVerifiedAt: Date,
    email: { type: String, lowercase: true, trim: true },
    emailVerifiedAt: Date,
    name: { type: String, trim: true },
    avatarUrl: String,
    alternativePhone: { type: String, match: /^\+[1-9][0-9]{7,14}$/ },
    dateOfBirth: Date,
    gender: { type: String, enum: ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY", null], default: null },
    deletionRequestedAt: Date, // customer asked for erasure; handled by staff under retention rules
    google: { type: googleIdentitySchema, default: null },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED", "DELETED"], default: "ACTIVE" },
    suspendedAt: Date,
    suspendedReason: String,
    // Admin access = at least one role. A Google login alone never grants one.
    roleKeys: { type: [String], default: [] },
    defaultAddressId: { type: ObjectId, ref: "Address", default: null },
    marketingOptIn: { type: Boolean, default: false },
    lastLoginAt: Date,
    // Staff sign-in (email + password). Customers never have one. Never selected by default.
    passwordHash: { type: String, select: false },
    passwordChangedAt: Date,
    mustChangePassword: { type: Boolean, default: false },
    failedLoginCount: { ...int(0), default: 0 },
    lockedUntil: Date,
    deletedAt: Date,
    // Set only on customers imported from the previous PHP/MySQL site (scripts/legacy-migration). Never read by app code.
    legacy: { source: String, customerId: Number, migratedAt: Date },
  },
  { timestamps: true },
);
userSchema.pre("validate", function () {
  if (!this.mobile && !this.email) this.invalidate("mobile", "A user needs a mobile number or an email");
});
userSchema.index({ mobile: 1 }, { unique: true, partialFilterExpression: { mobile: { $type: "string" } } });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });
userSchema.index({ "google.sub": 1 }, { unique: true, partialFilterExpression: { "google.sub": { $type: "string" } } });
userSchema.index({ "legacy.source": 1, "legacy.customerId": 1 }, { unique: true, partialFilterExpression: { "legacy.customerId": { $type: "number" } } });
userSchema.index({ roleKeys: 1 });
userSchema.index({ status: 1, createdAt: -1 });
export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = defineModel("User", userSchema, "users");

// ── Role → permissions ─────────────────────────────────────────────────────
const roleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true }, // SUPER_ADMIN, PRODUCT_MANAGER, ORDER_MANAGER, MARKETING_MANAGER, SUPPORT_STAFF
    name: { type: String, required: true },
    description: String,
    permissions: { type: [String], default: [] }, // "products.write", "orders.refund", …
    isSystem: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export type RoleDoc = InferSchemaType<typeof roleSchema>;
export const Role = defineModel("Role", roleSchema, "roles");

// ── Session (one per device; absolute cap 90 days for customers) ───────────
// Hard ceilings enforced by the Session validator. The actual customer lifetime comes from .env (see customer-session.ts).
export const SESSION_MAX_MS = { CUSTOMER: 365 * 24 * 3600 * 1000, ADMIN: 12 * 3600 * 1000 } as const;

const sessionSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["CUSTOMER", "ADMIN"], required: true },
    authMethod: { type: String, enum: ["OTP", "GOOGLE", "PASSWORD"], required: true },
    tokenHash: { type: String }, // SHA-256 of the opaque cookie token; the token itself is never stored
    expiresAt: { type: Date, required: true }, // absolute; never extended
    idleExpiresAt: { type: Date, required: true }, // sliding; <= expiresAt
    lastSeenAt: { type: Date, default: Date.now },
    stepUpVerifiedAt: Date, // admin OTP on top of Google
    ipAddress: String,
    userAgent: String,
    deviceLabel: String,
    revokedAt: Date,
    revokeReason: {
      type: String,
      enum: ["LOGOUT", "LOGOUT_OTHER_DEVICES", "TOKEN_REUSE", "ADMIN_REVOKED", "ACCOUNT_SUSPENDED", "SECURITY_CHANGE", "EXPIRED", null],
      default: null,
    },
  },
  { timestamps: true },
);
sessionSchema.pre("validate", function () {
  const created = this.createdAt ?? new Date();
  if (this.expiresAt.getTime() - created.getTime() > SESSION_MAX_MS[this.kind] + 60_000) {
    this.invalidate("expiresAt", `${this.kind} sessions may not exceed their maximum lifetime`);
  }
  if (this.idleExpiresAt > this.expiresAt) this.invalidate("idleExpiresAt", "idleExpiresAt must not exceed expiresAt");
});
sessionSchema.index({ userId: 1, revokedAt: 1 });
sessionSchema.index({ tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $type: "string" } } });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }); // purge a week after absolute expiry
export type SessionDoc = InferSchemaType<typeof sessionSchema>;
export const Session = defineModel("Session", sessionSchema, "sessions");

// ── Refresh token (rotating; reuse of a used token revokes the session) ────
const refreshTokenSchema = new Schema(
  {
    sessionId: { type: ObjectId, ref: "Session", required: true },
    tokenHash: { type: String, required: true, unique: true }, // SHA-256; the token lives only in the cookie
    expiresAt: { type: Date, required: true },
    usedAt: Date,
    replacedById: { type: ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
refreshTokenSchema.index({ sessionId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 });
export type RefreshTokenDoc = InferSchemaType<typeof refreshTokenSchema>;
export const RefreshToken = defineModel("RefreshToken", refreshTokenSchema, "refresh_tokens");

// ── OTP verification (+ bounded event log for audit) ──────────────────────
const otpEventSchema = new Schema(
  {
    type: { type: String, enum: ["REQUESTED", "RESENT", "DELIVERY_UPDATE", "VERIFY_SUCCESS", "VERIFY_FAILURE", "LOCKED", "RATE_LIMITED"], required: true },
    detail: String,
    ipAddress: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const otpSchema = new Schema(
  {
    destination: { type: String, required: true, match: /^\+[1-9][0-9]{7,14}$/ },
    purpose: { type: String, enum: ["LOGIN", "LINK_ACCOUNT", "ADMIN_STEP_UP", "CHANGE_MOBILE"], required: true },
    userId: { type: ObjectId, ref: "User", default: null },
    codeHash: { type: String, required: true }, // HMAC-SHA256(code, OTP_PEPPER); never the code
    active: { type: Boolean, default: true }, // false once consumed, locked or replaced
    expiresAt: { type: Date, required: true },
    attempts: { ...int(0), default: 0 },
    maxAttempts: { ...int(1), default: 5 },
    sendCount: { ...int(1), default: 1 },
    resendAvailableAt: { type: Date, required: true },
    consumedAt: Date,
    lockedAt: Date,
    provider: String,
    providerMessageId: String,
    deliveryStatus: { type: String, enum: ["QUEUED", "SENT", "DELIVERED", "FAILED", "UNDELIVERED"], default: "QUEUED" },
    deliveryUpdatedAt: Date,
    ipAddress: String,
    userAgent: String,
    events: { type: [otpEventSchema], default: [] },
  },
  { timestamps: true },
);
// At most one live OTP per mobile+purpose; a resend replaces it.
otpSchema.index({ destination: 1, purpose: 1 }, { unique: true, partialFilterExpression: { active: true } });
otpSchema.index({ providerMessageId: 1 }, { partialFilterExpression: { providerMessageId: { $type: "string" } } });
otpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 }); // verification logs kept 30 days
export type OtpDoc = InferSchemaType<typeof otpSchema>;
export const OtpVerification = defineModel("OtpVerification", otpSchema, "otp_verifications");

// ── Account link request (Google email matches an existing account) ───────
const linkRequestSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    googleSub: { type: String, required: true },
    email: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
  },
  { timestamps: true },
);
linkRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type AccountLinkRequestDoc = InferSchemaType<typeof linkRequestSchema>;
export const AccountLinkRequest = defineModel("AccountLinkRequest", linkRequestSchema, "account_link_requests");

// ── Rate-limit bucket (fixed window, shared by all app instances) ──────────
const rateLimitSchema = new Schema({
  _id: { type: String }, // `${key}:${windowStartMs}`
  count: { ...int(0), default: 0 },
  expiresAt: { type: Date, required: true },
});
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type RateLimitDoc = InferSchemaType<typeof rateLimitSchema>;
export const RateLimitBucket = defineModel("RateLimitBucket", rateLimitSchema, "rate_limits");
