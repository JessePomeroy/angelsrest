"""Forward original Stripe-signed sandbox deliveries to the unchanged local handler."""
import json, os, pathlib, subprocess, time, urllib.request, urllib.error

root = pathlib.Path(__file__).resolve().parent
env = dict(os.environ, CONVEX_DEPLOYMENT='dev:adjoining-iguana-707')
for key in ('CONVEX_DEPLOY_KEY','CONVEX_SELF_HOSTED_URL','CONVEX_SELF_HOSTED_ADMIN_KEY'):
    env.pop(key, None)

def run(name, args):
    result = subprocess.run(['pnpm','exec','convex','run',name,json.dumps(args),'--deployment',
        'thinkingofview:angelsrest-crm:dev/invoice-verification'], cwd=root/'sandbox-app/packages/crm-api',
        env=env, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError('Convex operator call failed: '+name)
    return json.loads(result.stdout) if result.stdout.strip() else None

deadline = time.monotonic() + 3600
while time.monotonic() < deadline:
    for row in run('invoiceVerification:pending', {}):
        request = urllib.request.Request('http://127.0.0.1:5198/api/webhooks/stripe',
            data=row['body'].encode(), headers={'Content-Type':'application/json', 'Stripe-Signature':row['signature']})
        try:
            response = urllib.request.urlopen(request, timeout=30)
            status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
        record = {'deliveryId':row['_id'],'eventId':row['eventId'],'handlerStatus':status,
            'apiVersion':json.loads(row['body'])['api_version'],'forwardedAt':time.time()}
        print(json.dumps(record),flush=True)
        run('invoiceVerification:acknowledge', {'id':row['_id'],'responseStatus':status})
        if not 200 <= status < 300:
            raise RuntimeError('Handler rejected original Stripe delivery; stop to inspect')
    time.sleep(2)
