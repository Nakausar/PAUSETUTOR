# What PAUSE records about participants

Plain-language summary for ethics applications, consent forms and privacy notices.
Technical definitions are in [EVENT_CODEBOOK.md](EVENT_CODEBOOK.md).

## Identity
* **Email address and password** (password stored only as a secure hash by Supabase Auth), used to sign in.
* A random **participant ID** (e.g. `P-3F9A21C0`). Research exports use only this ID, never the email.
* Whether the participant ticked the **consent** statement at sign-up.

## Learning activity
* **Plans** and plan confidence ratings, including later versions.
* **Code**: the current version, plus a snapshot every time the code is run, tested, saved or revised, and every 15 seconds while it changes.
* **Program runs**: input, output and error messages; **test case** results.
* **AI tutor conversations**: each request type, the question, the AI's answer, follow-up questions, and, for a complete solution, the reason given. The participant's plan, current code and last error are sent to the AI provider (OpenAI) with each request.
* **Scrutiny** judgments of AI answers, critiques and decisions (accept / modify / reject).
* **Reflections** at the end of each task.

* **Questionnaires** set up by the researchers (for example background, prior experience with programming and AI, usability), with the time taken to complete them.

## Interaction behaviour
* Time-stamped **events** for each action above and each move between phases.
* **Pastes** into any text field: which field, the length and the first 5,000 characters, and whether the text matches an AI answer.
* **Copying** text from an AI answer.
* **Leaving the page**: when the participant switches to another tab or window for 5 seconds or more, and for how long.
* **Inactivity**: periods of 60 seconds or more without keyboard, mouse or scroll activity.

PAUSE does **not** record keystrokes individually, screen contents outside the PAUSE page, other websites visited, webcam, microphone or location.

## Where data is processed
* **Supabase** (database and sign-in): region chosen at project creation; use an EU region.
* **OpenAI** (AI tutor and draft assessments): receives the task, plan, code, error and question for each AI request. Check the current OpenAI data-processing terms for retention.
* **Student code runs in the participant's own browser**; it is not sent to a code-execution service, except as a fallback if the browser cannot load Python (then the `run-python` function sends it to the public Judge0 service). Set `VITE_CODE_RUNNER=browser-only` to switch the fallback off.

## Example wording for a consent form
> While you use PAUSE, the system records your plans, code (saved automatically every 15 seconds while you edit), program runs and test results, your conversations with the AI tutor, and your reflections. It also records when you copy or paste text, when you switch away from the PAUSE page, and when you are inactive for a minute or more. Your questions, plan and code are sent to OpenAI to generate tutor responses. Research data is stored under a random participant ID, not your name or email.
