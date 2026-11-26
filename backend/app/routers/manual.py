"""Owner corrections without spreadsheets. Every change uses existing upload snapshots/rollback."""
import calendar
import datetime as dt
import hashlib
import json
import re
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..audit import log
from ..data import input_entries, ui_settings
from ..db import get_db
from ..models import FuelDay, Mileage, Operation, Period, Upload, User, Vehicle
from ..security import require_roles
from ..uploads import VAT_RATES, apply_upload, row_to_dict
from .input import EntryIn, validate_entry

router = APIRouter(prefix='/api/manual', tags=['manual'])
owner = require_roles('admin')
SHARED = {'shared_gen': 'Общехоз', 'shared_service': 'Сервис', 'shared_tractor': 'Трактор'}
LABELS = {'finance':'Финансы и пробег','fuel':'Топливо','shared':'Общие расходы'}


def month(db, ym, writing=False):
    if not re.fullmatch(r'20\d\d-(0[1-9]|1[0-2])', ym):
        raise HTTPException(422, 'Месяц в формате ГГГГ-ММ')
    p = db.scalar(select(Period).where(Period.ym == ym))
    if writing and (not p or p.status != 'open'):
        raise HTTPException(409, 'Месяц закрыт. Сначала откройте его для исправления с указанием причины.')
    return p


def bounds(ym):
    y, m = map(int, ym.split('-'))
    return dt.date(y, m, 1), dt.date(y, m, calendar.monthrange(y, m)[1])


def records(db, ym, kind, key):
    if kind == 'shared':
        if key not in SHARED:
            raise HTTPException(422, 'Неизвестная общая статья')
        return list(db.scalars(select(Operation).where(Operation.ym == ym, Operation.vehicle_id.is_(None), Operation.article == key).order_by(Operation.id)))
    v = db.scalar(select(Vehicle).where(Vehicle.key == key))
    if not v:
        raise HTTPException(404, 'Машина не найдена')
    if kind == 'fuel':
        start, end = bounds(ym)
        return list(db.scalars(select(FuelDay).where(FuelDay.vehicle_id == v.id, FuelDay.date >= start, FuelDay.date <= end).order_by(FuelDay.id)))
    if kind != 'finance':
        raise HTTPException(422, 'Неизвестный вид правки')
    return [*db.scalars(select(Mileage).where(Mileage.ym == ym, Mileage.vehicle_id == v.id).order_by(Mileage.id)),
            *db.scalars(select(Operation).where(Operation.ym == ym, Operation.vehicle_id == v.id).order_by(Operation.id))]


def version(rows):
    data=[{'table':r.__tablename__, **row_to_dict(r)} for r in rows]
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()


class Change(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='forbid')
    expected: str = Field(min_length=64, max_length=64)
    entry: EntryIn | None = None
    value: Decimal | None = Field(default=None, ge=-1000000000000, le=1000000000000)
    vat: str = '22%'
    gross: bool = True
    document: str | None = Field(default=None, max_length=128)


@router.get('/{ym}')
def state(ym: str, user: User = Depends(owner), db: Session = Depends(get_db)):
    p = month(db, ym)
    vehicles = list(db.scalars(select(Vehicle)))
    keys = {v.id:v.key for v in vehicles}
    entries = input_entries(db, keys, [ym]).get(ym, {})
    monthly = {(uid, m['ym']) for uid, plan in db.execute(select(Upload.id, Upload.plan).where(Upload.kind=='park'))
               for m in plan.get('fuel', []) if m.get('monthly')}
    fuel, finances = {}, {}
    for v in vehicles:
        fs = records(db, ym, 'finance', v.key)
        finances[v.key] = {'entry':entries.get(v.key,{}), 'version':version(fs),
                           'legacy':any(isinstance(r,Operation) and r.source not in ('manual','template') for r in fs)}
        rs = records(db, ym, 'fuel', v.key)
        has_monthly = any((r.upload_id,ym) in monthly for r in rs)
        liters = sum((r.rn_l+r.e100_l for r in rs),Decimal(0)) if has_monthly or any(r.rn_l or r.e100_l for r in rs) else None
        fuel[v.key] = {'liters':float(liters) if liters is not None else None,'version':version(rs),'daily':bool(rs) and not has_monthly}
    shared = {}
    for article in SHARED:
        rs = records(db,ym,'shared',article)
        same = len({(r.vat_rate,r.vat_mode) for r in rs})<=1
        gross = rs[0].vat_mode!='net' if rs and same else True
        amount = sum((r.amount_gross_kop if gross else r.amount_net_kop for r in rs),0)/100 if rs else None
        shared[article] = {'amount':amount,'vat':rs[0].vat_rate if rs and same else '22%','gross':gross,
                           'document':rs[0].document if len(rs)==1 else None,'version':version(rs),'mixed':not same,
                           'legacy':any(r.source not in ('manual','template') for r in rs)}
    users={u.id:u.full_name for u in db.scalars(select(User))}
    history = []
    # Read metadata only: historical backups can be large and are not needed here.
    query = select(Upload.id, Upload.filename, Upload.status, Upload.uploaded_by,
                   Upload.uploaded_at, Upload.months, Upload.preview).where(
                       Upload.filename.startswith('Правка на сайте · ')).order_by(Upload.id.desc())
    for u in db.execute(query).mappings():
        if ym not in u['months'] or not u['preview'].get('manual'):
            continue
        history.append({'id':u['id'],'label':u['filename'],'status':u['status'],
                        'who':users.get(u['uploaded_by'],''),'at':u['uploaded_at'].isoformat()})
        if len(history)==30:
            break
    return {'ym':ym,'status':p.status if p else None,'finance':finances,'fuel':fuel,'shared':shared,'history':history}


@router.put('/{ym}/{kind}/{key}')
def save(ym: str, kind: str, key: str, e: Change, user: User = Depends(owner), db: Session = Depends(get_db)):
    # Same serialization as reviewed packages, also protects the check of the expected version.
    if db.bind.dialect.name=='postgresql':
        db.execute(text('LOCK TABLE vehicles, periods, operations, mileage, fuel_days, uploads IN SHARE ROW EXCLUSIVE MODE'))
    month(db,ym,True)
    if kind!='finance' and 'value' not in e.model_fields_set:
        raise HTTPException(422,'Не передано новое значение')
    old = records(db,ym,kind,key)
    if version(old)!=e.expected:
        raise HTTPException(409,'Данные уже изменились на другом экране. Обновите страницу и повторите правку.')
    plan = {'ym':ym,'cars':[],'shared':[]} if kind!='fuel' else {'fuel':[]}
    label = SHARED[key] if kind=='shared' else db.scalar(select(Vehicle.name).where(Vehicle.key==key))
    extra = []
    if kind=='finance':
        if not e.entry:
            raise HTTPException(422,'Не переданы финансовые показатели')
        if any(isinstance(r,Operation) and r.source not in ('manual','template') for r in old):
            raise HTTPException(409,'Здесь есть исторические итоги без полной расшифровки. Нужен финансовый шаблон, чтобы не смешать разные расчёты.')
        amounts, errs=validate_entry(e.entry,ui_settings(db),ym)
        if errs:
            raise HTTPException(422,errs)
        v=db.scalar(select(Vehicle).where(Vehicle.key==key))
        plan['cars']=[{'vehicle_id':v.id,'key':key,'create':None,'km':e.entry.km,'days':e.entry.days,
                      'amounts':{a:int(round(v*100)) for a,v in amounts.items()},'vat':e.entry.vat,'gross':e.entry.gross,'doc':e.entry.document}]
    elif kind=='shared':
        if any(r.source not in ('manual','template') for r in old):
            raise HTTPException(409,'Это историческая общая сумма без расшифровки. Нужен финансовый шаблон для корректного перехода к статьям.')
        if e.vat not in VAT_RATES or (e.vat=='без НДС' and e.gross and e.value):
            raise HTTPException(422,'Проверьте ставку НДС и признак «с НДС».')
        if e.value is not None:
            if e.value!=e.value.quantize(Decimal('.01')):
                raise HTTPException(422,'Сумма — не больше двух знаков после запятой')
            plan['shared']=[{'article':key,'kop':int(e.value*100),'vat':e.vat,'gross':e.gross,'doc':e.document}]
        extra=[row_to_dict(r) for r in old]
        for r in old:db.delete(r)
        db.flush()
    else:
        if e.value is not None and (not e.value.is_finite() or not 0<=e.value<=1000000 or e.value!=e.value.quantize(Decimal('.001'))):
            raise HTTPException(422,'Литры — от 0 до 1 000 000, не больше трёх знаков после запятой')
        if e.value is not None:
            plan['fuel']=[{'ym':ym,'monthly':True,'days':[[key,ym+'-01',float(e.value),0,0]]}]
        else:
            extra=[row_to_dict(r) for r in old]
            for r in old:db.delete(r)
            db.flush()
    up=Upload(kind='park' if kind=='fuel' else 'template',filename=f'Правка на сайте · {label} · {ym} · {LABELS[kind]}',
              sha256=uuid.uuid4().hex*2,size=0,path='',months=[ym],status='parsed',plan=plan,
              preview={'manual':True,'kind_name':'Правка на сайте','sections':[],'can_apply':False},uploaded_by=user.id)
    db.add(up);db.flush()
    result=apply_upload(db,up,user)
    if extra:
        backup=dict(up.backup);field='fuel_days' if kind=='fuel' else 'operations'
        backup[field]=extra+backup[field];up.backup=backup
    if kind!='fuel':
        for r in db.scalars(select(Operation).where(Operation.upload_id==up.id)): r.source='manual'
        for r in db.scalars(select(Mileage).where(Mileage.upload_id==up.id)): r.source='manual'
    up.preview={**up.preview,'result':result or ['Значение очищено']}
    log(db,user,'manual',ym,f'{label}: {LABELS[kind]}',json.dumps([row_to_dict(r) for r in old],default=str,ensure_ascii=False),e.model_dump_json())
    db.commit()
    return {'ok':True,'upload_id':up.id}
