# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub Security Advisories:
open the repository's **Security** tab and choose **Report a vulnerability**.
Do not open a public issue for a security problem.

Include what you found, how to reproduce it, and the app version. You will get
a reply as soon as possible, and a fix will be released before details are
made public.

## Supported versions

Only the latest release receives security fixes.

## Scope

Your Flight Deck stores its data locally and has no server. Of most interest:
anything that could expose the stored Gemini API key, read or change files
outside the app's own data folder, corrupt a backup or restore, or run content
from an imported PDF or study packet as code.
