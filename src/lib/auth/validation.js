import { z } from "zod";
import { registrationBlocks, registrationCourses, registrationTeams, registrationYears } from "@/lib/auth/registration-options";

const namePattern = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
const coursePattern = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} .&'()+\/-]*$/u;
const academicLabelPattern = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} ._-]*$/u;

const nameField = (label) => z
  .string()
  .trim()
  .min(1, `${label} is required.`)
  .max(80, `${label} must be 80 characters or fewer.`)
  .regex(namePattern, `${label} can contain letters, spaces, apostrophes, periods, and hyphens.`);

const academicField = (label, maximumLength = 60) => z
  .string()
  .trim()
  .min(1, `${label} is required.`)
  .max(maximumLength, `${label} must be ${maximumLength} characters or fewer.`)
  .regex(academicLabelPattern, `${label} can contain letters, numbers, spaces, periods, underscores, and hyphens.`);

const emailField = z
  .string()
  .trim()
  .max(254, "Email must be 254 characters or fewer.")
  .email("Enter a valid email address.")
  .transform((email) => email.toLowerCase());

const passwordField = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Password must be 128 characters or fewer.")
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.")
  .regex(/[^A-Za-z0-9]/, "Include a symbol.");

export const passwordResetSchema = z.object({ email: emailField });

export const passwordUpdateSchema = z.object({
  password: passwordField,
  confirmPassword: z.string().min(1, "Confirm your password."),
}).refine((values) => values.password === values.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
});

export const studentProfileSchema = z.object({
  firstName: nameField("First name"),
  lastName: nameField("Last name"),
  course: z
    .string()
    .trim()
    .min(1, "Course is required.")
    .max(120, "Course must be 120 characters or fewer.")
    .regex(coursePattern, "Course contains unsupported characters."),
  year: academicField("Year", 40),
  block: academicField("Block"),
  team: academicField("Team"),
});

const optionalFilter = (label, maximumLength, pattern) => z
  .string()
  .trim()
  .max(maximumLength, `${label} must be ${maximumLength} characters or fewer.`)
  .transform((value) => value.toLowerCase() === "all" ? "" : value)
  .refine((value) => value === "" || pattern.test(value), `${label} contains unsupported characters.`)
  .transform((value) => value || null);

export const attendanceSessionSchema = z.object({
  title: z.string().trim().min(1, "Attendance title is required.").max(120, "Title must be 120 characters or fewer."),
  description: z.string().trim().max(1000, "Description must be 1000 characters or fewer."),
  startAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Choose a valid start date and time."),
  endAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Choose a valid end date and time."),
  locationRequirement: z.enum(["required", "optional", "disabled"]),
  course: optionalFilter("Course", 120, coursePattern),
  year: optionalFilter("Year", 40, academicLabelPattern),
  block: optionalFilter("Block", 60, academicLabelPattern),
  team: optionalFilter("Team", 60, academicLabelPattern),
}).refine((values) => Date.parse(values.endAt) > Date.parse(values.startAt), {
  path: ["endAt"],
  message: "End time must be after start time.",
}).refine((values) => Date.parse(values.endAt) > Date.now(), {
  path: ["endAt"],
  message: "End time must be in the future.",
});

const coordinateField = (label, minimum, maximum) => z
  .string()
  .trim()
  .min(1, `${label} is required.`)
  .refine((value) => Number.isFinite(Number(value)), `${label} must be a valid number.`)
  .transform(Number)
  .pipe(z.number().min(minimum, `${label} must be at least ${minimum}.`).max(maximum, `${label} must be at most ${maximum}.`));

export const schoolLocationSchema = z.object({
  code: z.string().trim().min(2, "Gate code is required.").max(32, "Gate code must be 32 characters or fewer.")
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]+$/, "Gate code can contain letters, numbers, and hyphens."),
  name: z.string().trim().min(1, "Location name is required.").max(120, "Location name must be 120 characters or fewer."),
  description: z.string().trim().max(500, "Description must be 500 characters or fewer."),
  latitude: coordinateField("Latitude", -90, 90),
  longitude: coordinateField("Longitude", -180, 180),
  radiusMeters: z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/, "Radius must be a positive whole number.")
    .transform(Number)
    .pipe(z.number().int().positive("Radius must be greater than zero.")),
  maxAccuracyMeters: z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/, "Maximum accuracy must be a positive whole number.")
    .transform(Number)
    .pipe(z.number().int().positive("Maximum accuracy must be greater than zero.")),
  boundaryUncertaintyMeters: z
    .string()
    .trim()
    .regex(/^\d+$/, "Boundary uncertainty must be a non-negative whole number.")
    .transform(Number)
    .pipe(z.number().int().nonnegative("Boundary uncertainty cannot be negative.")),
});

export const applicationSettingsSchema = z.object({
  schoolTimezone: z.string().trim().min(1, "School timezone is required.").max(80, "School timezone must be 80 characters or fewer.")
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Enter a valid IANA timezone, such as Asia/Manila."),
  reminderMinutes: z.string().trim().regex(/^\d+$/, "Reminder time must be a whole number.")
    .transform(Number).pipe(z.number().int().min(6).max(60)),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required."),
});

export const registrationSchema = z.object({
  firstName: nameField("First name"),
  lastName: nameField("Last name"),
  email: emailField,
  course: z.enum(registrationCourses),
  year: z.enum(registrationYears),
  block: z.enum(registrationBlocks),
  team: z.enum(registrationTeams),
  password: passwordField,
  confirmPassword: z.string().min(1, "Confirm your password."),
}).refine((values) => values.password === values.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
});