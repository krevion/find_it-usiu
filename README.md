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

Uploaded item photos currently use Django's local media directory. Render's
free web service filesystem is ephemeral, so configure persistent media storage
before relying on uploaded photos in production.