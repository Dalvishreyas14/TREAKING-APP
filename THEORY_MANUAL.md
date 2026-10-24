tag::theory_manual
tag::lifeos
tag::project_documentation

# THEORY MANUAL OF LIFEOS - AI Personal Life Tracker

## Table of Contents

- [1. Introduction](#1-introduction)
- [2. Objectives of the Project](#2-objectives-of-the-project)
- [3. Scope of the Project](#3-scope-of-the-project)
- [6. Literature Review](#6-literature-review)
- [4. System Architecture and Design](#4-system-architecture-and-design)
- [5. Modules and Features of the Project](#5-modules-and-features-of-the-project)
- [7. Database Design](#7-database-design)
- [8. User Interface Design](#8-user-interface-design)
- [9. AI Integration and Implementation Details](#9-ai-integration-and-implementation-details)
- [10. Security and Authentication](#10-security-and-authentication)
- [11. Testing and Validation](#11-testing-and-validation)
- [9. Advantages, Limitations and Future Scope](#9-advantages-limitations-and-future-scope)
- [12. Conclusion](#12-conclusion)
- [13. References](#13-references)
- [Appendix](#appendix)

---

## 1. Introduction

Life is becoming increasingly fast-paced, with individuals juggling multiple responsibilities such
as academics, work, health, finances, social life and personal growth. Managing all these aspects
manually through diaries, sticky notes or separate applications becomes inefficient and leads to
poor consistency. 

LIFEOS (Life Operating System) is an AI-Personal Life Tracker developed to act as a unified digital
platform that integrates planning, habit building, goal tracking, fitness, study management and
self-reflection into one intelligent workspace. 

The core idea of LIFEOS is to treat an individual's life as an operating system where tasks,
habits, goals and routines function together to improve productivity and overall well-being.
Instead of using multiple disconnected apps, LIFEOS provides a single centralized system that
helps the user "Plan your day. Build your habits. Understand your life." 

---

## 2. Objectives of the Project

The main objectives of the LIFEOS project are as follows:

1. **Centralization** - To bring all life management activities (tasks, habits, goals, fitness, study, routines) under one unified platform.
2. **Productivity Enhancement** - To help users organize their daily schedules and prioritize tasks effectively using a planner and focus timer.
3. **Habit Formation** - To promote consistency by providing streak tracking, habit logs, and automated reminders.
4. **Goal-Oriented Planning** - To break down long-term goals into milestones, projects and actionable tasks.
5. **Health & Fitness Management** - To track workouts, exercise routines, and integrate them with habit tracking.
6. **Academic & Study Tracking** - To manage study schedules, sessions, subjects and link them to focus time and habits.
7. **Self-Awareness** - To encourage reflection through journaling, mood/energy tracking and AI-generated insights.
8. **Intelligent Assistance** - To provide an AI-powered assistant capable of task parsing, day planning and data-driven recommendations.
9. **Time Management** - To utilize time blocks, routines, and the Pomodoro-based focus module for effective utilization of time.
10. **Gamification** - To motivate users through XP, levels, streaks, and achievements.

---

## 3. Scope of the Project

The scope of LIFEOS covers the development of a web-based personal life management system with
the following capabilities:

- **User Management**: Secure registration, login, email verification, password recovery and profile management.
- **Task Management**: Creation, categorization, prioritization, subtasks, recurrence, and completion tracking.
- **Habit Tracker**: Daily/weekly tracking with multiple habit types, schedules and streak calculation.
- **Goal & Project Tracking**: Hierarchical tracking with milestones and progress monitoring.
- **Daily Planner**: Time-block based day planning with drag-and-drop functionality.
- **Focus Mode**: Timer with pause/resume, session tracking and productivity analysis.
- **Fitness Module**: Workout logging, exercise library, workout routines and weekly fitness planning.
- **Study Module**: Study series, timetable management, session tracking and focus integration.
- **Routine Builder**: Custom morning/evening routines with step execution and run tracking.
- **Wellbeing & Journal**: Mood-energy check-ins and personal journal entries.
- **Calendar & Reminders**: Local calendar events, reminders with recurrence and notification system.
- **Analytics & Insights**: Visual reports, trends, correlations and AI-generated insights.
- **AI Assistant**: Intelligent chat, natural language task capture and day plan generation.
- **Cross-Platform Readiness**: Progressive Web App (PWA) support with Capacitor-based Android integration.

The project is designed for individual use. However, its modular design allows for future scalability.

---

## 6. Literature Review

Before developing LIFEOS, existing life management tools were studied to identify their strengths and limitations.

| Tool | Purpose | Observation |
|---|---|---|
| **Google Calendar** | Scheduling | Great for events, but lacks habit, goal and fitness tracking. |
| **Todoist** | Task Management | Efficient task lists, but minimal focus on wellness and self-reflection. |
| **Habitica** | Habit Tracking with Gamification | Motivating, but lacks detailed analytics and AI assistance. |
| **Notion** | All-in-One Workspace | Highly customizable, but complex for beginners and lacks built-in AI coaching. |
| **MyFitnessPal** | Fitness & Nutrition | Excellent for health, but isolated from productivity and goals. |
| **Forest App** | Focus Timer | Effective for focus, but not integrated with tasks or life planning. |

**Findings**: Most existing applications are domain-specific. There is a lack of a truly integrated "Life Operating System" that connects productivity, health, learning and self-awareness with intelligent insights. 

LIFEOS aims to bridge this gap by unifying all these domains into one cohesive, data-driven platform.

---

## 4. System Architecture and Design

### 4.1 Architecture Overview

LIFEOS follows a **Client-Server Architecture** based on the **Next.js App Router** framework. The system is designed with a clear separation of concerns between presentation, logic, and data layers.

### 4.1.1 Architectural Diagram Concept

The architecture consists of the following layers:

- **Presentation Layer (Frontend)** - Built using React 19, Next.js App Router, Tailwind CSS and Radix UI components.
- **Application Layer (Backend Logic)** - Implemented using Next.js Server Components, Route Handlers and Server Actions.
- **Service Layer** - Contains domain-specific logic in `src/lib/` (tasks, habits, goals, fitness, study, AI, etc.).
- **Data Access Layer** - Managed by Prisma ORM with a PostgreSQL database.
- **Security Layer** - Auth.js for authentication, Zod for validation, and middleware for route protection.
- PRISM MEMO – THEORETICAL MANUAL

---

### 4.2 Design Principles

- **Modularity** - Each feature is organized into its own module for easy maintenance.
- **Separation of Concences (SoC)** - UI, business logic and data access are kept distinct.
- **Scalability** - The system can accommodate new features with minimal changes.
-tag :theory_manual_#file:theory_manual
- **Security by Design** - Authentication, authorization and validation are enforced at every level.
- **Truth-First AI** - The AI assistant only uses verified data from the database to generate responses.
- **Data Ownership** - All user data is strictly scoped to the authenticated user.
- **Progressive Enhancement** - Designed as a PWA with offline capability and mobile adaptability.

---

## 5. Modules and Features of the Project

LIFEOS is divided into the following functional modules:

### 5.1 Authentication & User Management
- **Registration & Login**: Secure sign-up with email and password.
- **Email Verification**: Token-based verification for account security.
- **Password Recovery**: Secure reset mechanism with hashed tokens.
- **OAuth Support**: Optional "Sign in with Google" integration.
- **Onboarding**: Collects user preferences to personalize the experience.
- **Profile Settings**: Manage name, timezone, theme, language and preferences.

### 5.2 Dashboard Module
The dashboard acts as the user's home screen, providing a quick overview of the day. It displays:
- Today's tasks and priorities
- Habit streaks and progress
- Focus time summary
- Goals in progress
- Activity strip and weekly overview
- Quick capture for tasks and habits

### 5.3 Task & Planner Module
- **Task List**: Create, edit, delete, prioritize and mark tasks as completed.
- **Subtasks**: Break large tasks into smaller actionable steps.
- **Recurring Tasks**: Set tasks to repeat daily, weekly or custom intervals.
- **Priority Engine**: Uses importance, urgency and priority score to classify tasks.
- **Daily Planner**: Visual timeline with time-blocks for scheduling tasks, routines and events.
- **Drag & Drop**: Effortlessly rearrange activities throughout the day.

### 5.4 Habit Tracker Module
- **Habit Creation**: Support for BOOLEAN, COUNT, D
tag :theory_manual_#file:theory_manual
URATION, DISTANCE and QUANTITY type habits.
- **Habit Schedule**: Define which days of the week the habit should be performed.
- **Habit Log**: Daily entries with completion status and value tracking.
- **Streak Tracking**: Current and longest streaks to encourage consistency.
- **Double-Count Protection**: Prevents duplication when habits are linked to workouts or study sessions.
- **Habit Grid**: Visual representation of habit progress over time.

### 5.5 Goal & Project Management Module
- **Goals**: Set long-term goals with SHORT, MEDIUM and LONG horizons.
- **Milestones**: Break goals into measurable checkpoints with status tracking.
- **Projects**
tag :theory_manual_#file:theory_manual
: Create projects linked to goals or standalone, with status, deadlines and progress.
- **Project Tasks**: Link existing tasks to projects and assign them to milestones.
- **Goal Check-Ins**: Regular progress updates for accountability.
- **Progress Calculation# PRISM MEMO – THEORETICAL MANUAL</content>