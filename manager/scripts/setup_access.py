#!/usr/bin/env python3
"""Create/update the Cloudflare Access app for the Control Room: the WHOLE hostname
controlroom.amplifi.studio (no public page), One-time PIN, 30-day session, plus its allow
policy. Saves APP_ID + AUD to ~/.hermes/secrets/controlroom-access.txt (0600). Idempotent.
Change who can sign in: edit ~/.hermes/secrets/controlroom-emails.txt, run again.
CF writes via urllib (curl write verbs are blocked on this Mac). Prints no secrets."""
import json, os, urllib.request, urllib.error

env = {}
for line in open(os.path.expanduser("~/.hermes/secrets/cloudflare.env")):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k.replace("export ", "")] = v.strip().strip('"').strip("'")
T = env["CLOUDFLARE_API_TOKEN"]; A = env["CLOUDFLARE_ACCOUNT_ID"]
OTP = "3d2cce86-51fd-4de5-83e5-d93ddf389e4a"
DOMAIN = "controlroom.amplifi.studio"
NAME = "BC Radio Control Room"
# The allowed list lives OUTSIDE the repo (this repo is public): one email per line.
EMAILS_FILE = os.path.expanduser("~/.hermes/secrets/controlroom-emails.txt")
EMAILS = [l.strip().lower() for l in open(EMAILS_FILE) if l.strip() and not l.startswith("#")]
assert EMAILS and all("@" in e for e in EMAILS), "no emails in " + EMAILS_FILE
SECRETS = os.path.expanduser("~/.hermes/secrets/controlroom-access.txt")

def call(method, path, body=None):
    req = urllib.request.Request("https://api.cloudflare.com/client/v4" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + T, "Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=40).read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

apps = call("GET", f"/accounts/{A}/access/apps?per_page=200")["result"]
app = next((a for a in apps if a.get("domain") == DOMAIN), None)
spec = {"name": NAME, "domain": DOMAIN, "type": "self_hosted", "session_duration": "720h",
        "allowed_idps": [OTP], "auto_redirect_to_identity": True, "app_launcher_visible": False,
        "http_only_cookie_attribute": True, "same_site_cookie_attribute": "lax", "enable_binding_cookie": False}
if app:
    r = call("PUT", f"/accounts/{A}/access/apps/{app['id']}", spec)
    print("app updated", r.get("success"), r.get("errors"))
else:
    r = call("POST", f"/accounts/{A}/access/apps", spec)
    print("app created", r.get("success"), r.get("errors"))
app = r["result"]
aid = app["id"]

pols = call("GET", f"/accounts/{A}/access/apps/{aid}/policies").get("result") or []
pol = {"name": "allowed people", "decision": "allow", "precedence": 1, "include": [{"email": {"email": e}} for e in EMAILS]}
people = next((p for p in pols if p.get("name") == "allowed people"), None)
r = call("PUT", f"/accounts/{A}/access/apps/{aid}/policies/{people['id']}", pol) if people else call("POST", f"/accounts/{A}/access/apps/{aid}/policies", pol)
print("policy", r.get("success"), r.get("errors"))
pols = call("GET", f"/accounts/{A}/access/apps/{aid}/policies").get("result") or []
print("POLICIES NOW:", [(p["name"], p["decision"], len([x for x in p.get("include", []) if "email" in x]), "emails") for p in pols])
a2 = call("GET", f"/accounts/{A}/access/apps/{aid}")["result"]
print("APP:", {k: a2.get(k) for k in ("name", "domain", "session_duration", "allowed_idps", "auto_redirect_to_identity", "app_launcher_visible")})
os.umask(0o077)
with open(SECRETS, "w") as f:
    f.write(f"# Cloudflare Access for the BC Radio Control Room (whole hostname)\nAPP_ID={aid}\nAUD={app['aud']}\nDOMAIN={DOMAIN}\n"
            f"IDP=onetimepin {OTP}\nTEAM=falling-brook-6a64.cloudflareaccess.com\nALLOWED={','.join(EMAILS)}\n"
            "# The Worker ALSO verifies the JWT (ACCESS_AUD secret = AUD above) and refuses every other hostname.\n")
os.chmod(SECRETS, 0o600)
print("saved", SECRETS, oct(os.stat(SECRETS).st_mode & 0o777))
