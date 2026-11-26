# Find It

## Django backend

The backend uses SQLite by default. To use Supabase, copy `backend/.env.example`
to `backend/.env` and set the session pooler host, username, and database
password from your Supabase project's Database settings. The local `.env` file
is ignored by Git.

Install dependencies and apply migrations:

```powershell
cd backend
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Create the initial administrator with `python manage.py createsuperuser`. In
`/admin/`, create Security accounts with an email and **Staff status** enabled. Security
passwords are stored as Django password hashes; only staff accounts can publish
found items or review claims.

## Deploy to Render

The root `render.yaml` defines the web service. In Render, create a Blueprint
from this GitHub repository and provide `DB_PASSWORD` using the Supabase
PostgreSQL session-pooler password. Render generates `DJANGO_SECRET_KEY`
automatically. The build installs dependencies, collects static files, and
applies migrations; the start command runs Gunicorn. Django trusts Render's
runtime hostname for hosts and CSRF requests automatically.

Uploaded item photos use Django's local media directory for development. For
Render, create a **public** Supabase Storage bucket and configure
`SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_ENDPOINT`,
`SUPABASE_STORAGE_REGION`, `SUPABASE_STORAGE_ACCESS_KEY_ID`, and
`SUPABASE_STORAGE_SECRET_ACCESS_KEY` in the Render service environment. The
S3 endpoint, region, and server-side access keys are available in Supabase's
Storage settings. The Render Blueprint prompts for these values and requires
them before the service starts. Public access allows item photos to be viewed
by anyone; keep the S3 access keys private.

The Render free web service filesystem is ephemeral. Existing database records
whose photos were stored only on that filesystem need their original files
re-uploaded to the bucket; the app cannot recover files that are no longer
available.