import http from 'k6/http';
import { check, sleep } from 'k6';

export const options={scenarios:{readiness:{executor:'constant-vus',vus:Number(__ENV.VUS||5),duration:__ENV.DURATION||'30s'}},thresholds:{http_req_failed:['rate<0.01'],http_req_duration:['p(95)<500','p(99)<1000']}};
const base=__ENV.BASE_URL||'http://127.0.0.1:5000';
export default function(){const response=http.get(`${base}/health/ready`,{headers:{'x-correlation-id':`k6-${__VU}-${__ITER}`}});check(response,{'readiness is healthy':r=>r.status===200,'request id returned':r=>Boolean(r.headers['X-Request-Id'])});sleep(1);}
