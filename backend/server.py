from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import html as html_lib
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
import secrets
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Public base URL for shared links (set via supervisor environment).
APP_URL = os.environ.get('APP_URL', '').rstrip('/')

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str


class SharePageCreate(BaseModel):
    title: str = ""
    body: str = ""  # plain text (newline separated)
    kind: str = "note"  # note | page
    brand: str = "Made with Notes AI"


class SharePageOut(BaseModel):
    token: str
    manage_token: str
    url: str


# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]


# ---------------- Share as Link (read-only public pages) ----------------

def _render_shared_html(doc: dict) -> str:
    title = html_lib.escape(doc.get("title") or "Shared note")
    brand = html_lib.escape(doc.get("brand") or "Made with Notes AI")
    body = doc.get("body") or ""
    # Render plain-text body into safe HTML paragraphs / list items.
    lines = []
    for raw in body.split("\n"):
        line = raw.rstrip()
        esc = html_lib.escape(line)
        if not line.strip():
            lines.append("<div style='height:10px'></div>")
        elif line.lstrip().startswith(("- ", "* ", "\u2022 ")):
            lines.append(f"<li>{html_lib.escape(line.lstrip()[2:])}</li>")
        elif line.lstrip()[:2] in ("[ ", "[x", "[X", "\u2610", "\u2611"):
            lines.append(f"<div class='todo'>{esc}</div>")
        else:
            lines.append(f"<p>{esc}</p>")
    content = "\n".join(lines)
    created = html_lib.escape((doc.get("created_at") or "")[:10])
    return f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>{title}</title>
<style>
  :root {{ color-scheme: light dark; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
         background:#faf9f7; color:#181715; line-height:1.65; }}
  .wrap {{ max-width: 720px; margin: 0 auto; padding: 40px 22px 80px; }}
  .badge {{ display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700;
            color:#c2410c; background:#fff1e7; border:1px solid #fed7aa; padding:5px 11px; border-radius:999px; }}
  h1 {{ font-size: 30px; margin: 18px 0 6px; letter-spacing:-0.5px; }}
  .meta {{ color:#8a8781; font-size: 13px; margin-bottom: 26px; }}
  p {{ margin: 0 0 12px; font-size: 17px; }}
  li {{ font-size: 17px; margin: 4px 0 4px 20px; }}
  .todo {{ font-size: 17px; margin: 4px 0; }}
  .footer {{ margin-top: 48px; padding-top: 20px; border-top:1px solid #eee; color:#8a8781; font-size:13px; }}
  .footer a {{ color:#c2410c; text-decoration:none; }}
  @media (prefers-color-scheme: dark) {{
    body {{ background:#191817; color:#ece9e4; }}
    .badge {{ color:#fdba74; background:#2a1c12; border-color:#5a3a20; }}
    .meta,.footer {{ color:#8a8781; }}
    .footer {{ border-top-color:#333; }}
  }}
</style></head>
<body><div class="wrap">
  <span class="badge">\u2728 {brand}</span>
  <h1>{title}</h1>
  <div class="meta">Read-only shared {html_lib.escape(doc.get('kind') or 'note')} \u2022 {created}</div>
  {content}
  <div class="footer">Shared securely from a Notes AI workspace. <br/>This is a read-only copy.</div>
</div></body></html>"""


@api_router.post("/shared", response_model=SharePageOut)
async def create_shared(payload: SharePageCreate):
    token = secrets.token_urlsafe(9)
    manage_token = secrets.token_urlsafe(12)
    doc = {
        "token": token,
        "manage_token": manage_token,
        "title": (payload.title or "Shared note")[:300],
        "body": (payload.body or "")[:100000],
        "kind": payload.kind if payload.kind in ("note", "page") else "note",
        "brand": (payload.brand or "Made with Notes AI")[:80],
        "revoked": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.shared_pages.insert_one(doc)
    base = APP_URL or ""
    return SharePageOut(token=token, manage_token=manage_token, url=f"{base}/api/shared/{token}")


@api_router.get("/shared/{token}", response_class=HTMLResponse)
async def get_shared(token: str):
    doc = await db.shared_pages.find_one({"token": token})
    if not doc or doc.get("revoked"):
        return HTMLResponse(
            "<html><body style='font-family:sans-serif;text-align:center;padding:60px'>"
            "<h2>Link unavailable</h2><p>This shared link has been revoked or does not exist.</p>"
            "</body></html>",
            status_code=404,
        )
    return HTMLResponse(_render_shared_html(doc))


@api_router.delete("/shared/{token}")
async def revoke_shared(token: str, key: str = Query(...)):
    doc = await db.shared_pages.find_one({"token": token})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    if doc.get("manage_token") != key:
        raise HTTPException(status_code=403, detail="Invalid manage key")
    await db.shared_pages.update_one({"token": token}, {"$set": {"revoked": True}})
    return {"revoked": True, "token": token}


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
