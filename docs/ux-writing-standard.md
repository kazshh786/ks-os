# KS OS UX writing standard

This standard applies to every user-facing screen, message, email and workflow in KS OS.

## 1. Write for the person using the product

Use familiar words that describe the user's goal.

Prefer:

- client
- person
- team member
- workspace
- booking
- payment
- website
- sign in
- sign out

Avoid exposing database or implementation language such as record, entity, object, payload, tenant, mutation, provisioning reference or invalid credentials unless the audience is explicitly technical and the term is required.

## 2. Make screens easy to scan

- Put the action or outcome first.
- Use sentence case.
- Keep supporting text to four lines or fewer where practical.
- Keep explanatory text near 50 characters wide in the interface.
- Use short paragraphs and grouped facts.
- Do not use ampersands in user-facing copy. Write `and`.

## 3. Use one term for one concept

- Use **Sign in** and **Sign out** everywhere.
- Use **client** for a business served by the agency.
- Use **customer** only for a person booking with that business.
- Use **workspace** for the client's KS OS environment.
- Use **booking** for an appointment created through KS OS.
- Use **website** rather than site unless space is severely constrained.

Do not alternate between login, log in, logon and sign in.

## 4. Make actions precise

Buttons should:

- start with a verb;
- describe the result;
- use three words or fewer where practical;
- match the title of the dialog or screen they complete.

Examples:

- Create client
- Save plan
- Send invite
- Reset password
- Remove access
- Delete workspace

Avoid Submit, Go, Continue when a more specific result is available.

## 5. Guide every input

For unfamiliar or high-risk inputs, provide:

1. the information name;
2. a short explanation of why it is needed or how to succeed;
3. an example where the expected format is not obvious;
4. visible validation before the user submits.

Use persistent labels. Placeholders may support a label but must not replace it.

Prefill known information when it is safe and likely to be correct.

## 6. Help people recover from errors

An error message should:

1. state what happened in human language;
2. avoid blame;
3. give the next action.

Prefer:

> That password did not match. Try again or reset it.

Avoid:

> Invalid credentials.

Do not expose database errors, provider responses, stack traces or internal identifiers.

## 7. Use empty states to move work forward

Every meaningful empty state should explain:

1. what is currently empty;
2. why adding something creates value;
3. the next action.

Prefer:

> No clients yet. Create a client to collect approved facts, set up booking and build their website.

Avoid:

> No records found.

## 8. Explain destructive actions before confirmation

Destructive dialogs must show:

- the exact outcome;
- what will be removed;
- what will remain, when relevant;
- whether the action is reversible;
- visible confirmation requirements;
- a clear final action matching the dialog title.

Use typed confirmation phrases only for irreversible or high-impact actions.

## 9. Review checklist

Before merging user-facing copy, confirm:

- Does the first sentence state the value or action?
- Is database or system language hidden?
- Is terminology consistent?
- Is the CTA specific and short?
- Does the dialog title match its CTA?
- Are labels persistent and examples useful?
- Does the error explain the next step?
- Does the empty state help the user move forward?
- Are ampersands removed?
- Is the copy short enough to scan?
