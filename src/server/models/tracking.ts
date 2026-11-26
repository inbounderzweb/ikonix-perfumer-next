import { Schema, type InferSchemaType } from "mongoose";
import { ObjectId, defineModel, int } from "./_shared";
import { TRACKING_STATUS } from "../../lib/shipment-tracking";

export const SYNC_STATUS = ["RUNNING", "SUCCESS", "PARTIAL", "FAILED", "ABORTED"] as const;

// One row per courier event. `_id` is a hash of (shipment, consignment, code, date, time, office), so the same event
// can never be stored twice, even on a database where the secondary indexes have not been built yet.
const shipmentEventSchema = new Schema(
  {
    _id: { type: String },
    orderId: { type: ObjectId, ref: "Order", required: true },
    shipmentId: { type: ObjectId, required: true }, // Order.shipments[]._id
    carrier: { type: String, required: true },
    trackingNumber: { type: String, required: true },
    eventCode: { type: String, required: true },
    eventDescription: String,
    trackingStatus: { type: String, enum: [...TRACKING_STATUS, null], default: null }, // null = informational only
    eventAt: { type: Date, required: true }, // eventDate + eventTime read as India time
    eventDate: { type: String, required: true }, // YYYY-MM-DD as reported
    eventTime: String, // HH:mm:ss as reported
    eventOffice: String,
    nonDeliveryReason: String,
    rawEventData: Schema.Types.Mixed, // courier record without recipient personal data
    source: { type: String, enum: ["BULK_XML", "ARTICLE_API"], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
shipmentEventSchema.index({ shipmentId: 1, trackingNumber: 1, eventAt: -1 });
shipmentEventSchema.index({ trackingNumber: 1, eventAt: -1 });
export type ShipmentEventDoc = InferSchemaType<typeof shipmentEventSchema>;
export const ShipmentEvent = defineModel("ShipmentEvent", shipmentEventSchema, "shipment_events");

const trackingSyncLogSchema = new Schema(
  {
    carrier: { type: String, required: true },
    integrationMode: { type: String, required: true },
    trigger: { type: String, enum: ["SCHEDULED", "MANUAL", "RETRY", "RECONCILE", "TEST"], required: true },
    actorUserId: { type: ObjectId, ref: "User", default: null },
    syncStartedAt: { type: Date, required: true },
    syncCompletedAt: Date,
    recordsProcessed: { ...int(0), default: 0 },
    recordsUpdated: { ...int(0), default: 0 },
    newEvents: { ...int(0), default: 0 },
    failedRecords: { ...int(0), default: 0 },
    errorMessage: String,
    details: { type: [String], default: [] },
    syncStatus: { type: String, enum: SYNC_STATUS, default: "RUNNING" },
  },
  { timestamps: false },
);
trackingSyncLogSchema.index({ carrier: 1, syncStartedAt: -1 });
trackingSyncLogSchema.index({ syncStartedAt: 1 }, { expireAfterSeconds: 90 * 86_400 });
export type TrackingSyncLogDoc = InferSchemaType<typeof trackingSyncLogSchema>;
export const TrackingSyncLog = defineModel("TrackingSyncLog", trackingSyncLogSchema, "tracking_sync_logs");

// Checkpoint per downloaded bulk file: _id = "<customerId>:<eventCode>:<YYYY-MM-DD>".
const trackingSyncFileSchema = new Schema(
  {
    _id: { type: String },
    customerId: { type: String, required: true },
    eventCode: { type: String, required: true },
    eventDate: { type: String, required: true }, // YYYY-MM-DD
    status: { type: String, enum: ["OK", "NO_FILE", "RETRY", "FAILED"], required: true },
    contentHash: String,
    processedAt: Date, // start of the last successful download
    final: { type: Boolean, default: false }, // downloaded after the day closed: not fetched again
    records: { ...int(0), default: 0 },
    attempts: { ...int(0), default: 0 },
    nextAttemptAt: Date,
    lastError: String,
  },
  { timestamps: true },
);
trackingSyncFileSchema.index({ status: 1, eventDate: -1 });
export type TrackingSyncFileDoc = InferSchemaType<typeof trackingSyncFileSchema>;
export const TrackingSyncFile = defineModel("TrackingSyncFile", trackingSyncFileSchema, "tracking_sync_files");

// Distributed lock: one document per job, owned until `expiresAt`.
const jobLockSchema = new Schema({ _id: { type: String }, owner: { type: String, required: true }, expiresAt: { type: Date, required: true } });
export type JobLockDoc = InferSchemaType<typeof jobLockSchema>;
export const JobLock = defineModel("JobLock", jobLockSchema, "job_locks");
