import test from 'node:test';
import assert from 'node:assert/strict';
import {exchangeCalendar,announcedSession,inspectCalendar} from '../public/lab/exchange-calendar.mjs';
import {nextSession,membershipAt,technicalSeries} from '../public/lab/vn-market.mjs';
test('VN-01/02: T+ dates skip actual holidays and working Saturdays',()=>{
 const c=exchangeCalendar({from:'2026-08-28',to:'2026-09-07'}).sessions;
 assert.deepEqual(c,['2026-08-28','2026-09-03','2026-09-04','2026-09-07']);assert.equal(nextSession(c[0],3,c),'2026-09-07');
 assert.equal(announcedSession('2026-01-02'),false);assert.equal(announcedSession('2026-01-10'),false);assert.equal(announcedSession('2026-08-22'),false);assert.equal(announcedSession('2026-02-19'),false);
 assert.equal(announcedSession('2027-02-08'),null);assert.throws(()=>exchangeCalendar({from:'2027-01-01',to:'2027-01-10'}),/UNAVAILABLE/);
 assert.deepEqual(inspectCalendar(['2026-09-01'],'HOSE','2026-09-01','2026-09-03').unexpected,['2026-09-01']);
});
test('VN-04/05: index membership uses announcements and retains removed members',()=>{
 const c={membership:[{from:'2026-01-05',to:'2026-07-31',knownAt:'2025-12-30',member:true},{from:'2026-08-01',to:'2026-12-31',knownAt:'2026-07-28',member:false}]};
 assert.equal(membershipAt(c,'2026-01-02'),null);assert.equal(membershipAt(c,'2026-07-30'),true);assert.equal(membershipAt(c,'2026-08-03'),false);
});
test('VN-03: raw input remains intact across corporate normalization',()=>{
 const rows=[{date:'2026-09-03',open:100,high:100,low:100,close:100,volume:100},{date:'2026-09-04',open:50,high:50,low:50,close:50,volume:200}],original=structuredClone(rows);
 const normalized=technicalSeries(rows,{priceBasis:'raw',actions:[{type:'split',exDate:'2026-09-04',knownAt:'2026-08-01',priceFactor:.5,ratio:2}]});
 assert.equal(normalized.rows[1].close,100);assert.deepEqual(rows,original);
});
