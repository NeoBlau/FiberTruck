"""Таблицы FiberTrack. Деньги — BIGINT в копейках, литры — NUMERIC(12,3)."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy import (JSON, BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, Numeric,
                        String, Text, UniqueConstraint, func)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

ROLES = ('admin', 'viewer', 'input')


class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(64), unique=True)
    full_name: Mapped[str] = mapped_column(String(128))
    password_hash: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(16))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (CheckConstraint(f"role in {ROLES}", name='users_role_check'),)


class UserSession(Base):
    __tablename__ = 'sessions'
    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(256))
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    user: Mapped[User] = relationship()


class LoginAttempt(Base):
    __tablename__ = 'login_attempts'
    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(64), index=True)
    ip: Mapped[str | None] = mapped_column(String(64))
    success: Mapped[bool] = mapped_column(Boolean)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Vehicle(Base):
    __tablename__ = 'vehicles'
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(16), unique=True)          # канонический короткий номер: 885, 308М, 20Ф
    name: Mapped[str] = mapped_column(String(16))                       # для экрана: 885, 308 М, 020 Ф
    plate: Mapped[str | None] = mapped_column(String(16), unique=True)  # Т970ОН58
    make: Mapped[str | None] = mapped_column(String(16))
    model: Mapped[str | None] = mapped_column(String(64))
    year: Mapped[int | None] = mapped_column(Integer)
    tacho: Mapped[str | None] = mapped_column(String(32))
    odo_km: Mapped[int | None] = mapped_column(BigInteger)
    trailer: Mapped[str | None] = mapped_column(String(32))
    trailer_model: Mapped[str | None] = mapped_column(String(64))
    trailer_year: Mapped[int | None] = mapped_column(Integer)
    amort_kop: Mapped[int | None] = mapped_column(BigInteger)          # амортизация в месяц
    in_service_from: Mapped[dt.date | None] = mapped_column(Date)
    in_service_to: Mapped[dt.date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    history_only: Mapped[bool] = mapped_column(Boolean, default=False)  # была только в графиках прошлых лет
    manual: Mapped[bool] = mapped_column(Boolean, default=False)        # добавлена вручную, не из файлов
    edited: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Period(Base):
    """Месяц. Строки нет — месяц не начат (кроме текущего: он открывается сам)."""
    __tablename__ = 'periods'
    id: Mapped[int] = mapped_column(primary_key=True)
    ym: Mapped[str] = mapped_column(String(7), unique=True)            # 2026-11
    status: Mapped[str] = mapped_column(String(8))
    changed_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    __table_args__ = (CheckConstraint("status in ('open','closed')", name='periods_status_check'),)


class ScheduleMonth(Base):
    """График одной машины за месяц: коды статусов по дням, текст ячеек, ручные итоги и пересчёт."""
    __tablename__ = 'schedule_months'
    id: Mapped[int] = mapped_column(primary_key=True)
    ym: Mapped[str] = mapped_column(String(7), index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey('vehicles.id', ondelete='CASCADE'))
    codes: Mapped[str] = mapped_column(String(31))
    texts: Mapped[list] = mapped_column(JSON)
    totals: Mapped[dict | None] = mapped_column(JSON)    # ручные итоги диспетчера
    calc: Mapped[dict] = mapped_column(JSON)             # пересчёт по ячейкам
    source_row: Mapped[int | None] = mapped_column(Integer)
    vehicle: Mapped[Vehicle] = relationship()
    __table_args__ = (UniqueConstraint('ym', 'vehicle_id'),)


class Operation(Base):
    """Денежная операция. vehicle_id = NULL — общая (общехоз, сервис, трактор, амортизация)."""
    __tablename__ = 'operations'
    id: Mapped[int] = mapped_column(primary_key=True)
    ym: Mapped[str] = mapped_column(String(7), index=True)
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey('vehicles.id', ondelete='CASCADE'), index=True)
    article: Mapped[str] = mapped_column(String(32))
    amount_gross_kop: Mapped[int] = mapped_column(BigInteger)
    amount_net_kop: Mapped[int] = mapped_column(BigInteger)
    vat_kop: Mapped[int] = mapped_column(BigInteger, default=0)
    vat_rate: Mapped[str | None] = mapped_column(String(16))         # '22%' … 'без НДС'; NULL — не выделен
    vat_mode: Mapped[str] = mapped_column(String(8))                 # gross / net / unknown
    source: Mapped[str] = mapped_column(String(16))                  # import / manual / template / 1c
    entered_by: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (CheckConstraint('amount_net_kop + vat_kop = amount_gross_kop', name='operations_vat_check'),)


class Mileage(Base):
    __tablename__ = 'mileage'
    id: Mapped[int] = mapped_column(primary_key=True)
    ym: Mapped[str] = mapped_column(String(7))
    vehicle_id: Mapped[int] = mapped_column(ForeignKey('vehicles.id', ondelete='CASCADE'))
    km: Mapped[int | None] = mapped_column(Integer)
    worked_days: Mapped[int | None] = mapped_column(Integer)          # если машины нет в графике
    source: Mapped[str] = mapped_column(String(16), default='manual')
    entered_by: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    __table_args__ = (UniqueConstraint('ym', 'vehicle_id'),)


class FuelDay(Base):
    __tablename__ = 'fuel_days'
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey('vehicles.id', ondelete='CASCADE'))
    date: Mapped[dt.date] = mapped_column(Date, index=True)
    rn_l: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    e100_l: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    glonass_l: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    __table_args__ = (UniqueConstraint('vehicle_id', 'date'),)


class FleetDaysHistory(Base):
    """Помесячная сводка по парку из «Анализа простоев» (с 2021 года)."""
    __tablename__ = 'fleet_days_history'
    id: Mapped[int] = mapped_column(primary_key=True)
    ym: Mapped[str] = mapped_column(String(7), unique=True)
    worked: Mapped[int] = mapped_column(Integer)
    no_driver: Mapped[int] = mapped_column(Integer)
    idle: Mapped[int] = mapped_column(Integer)
    planned: Mapped[int] = mapped_column(Integer)
    unplanned: Mapped[int] = mapped_column(Integer)


class ReferenceValue(Base):
    """Эталоны для сверки: итог «Общий», заметки владельца руб/км."""
    __tablename__ = 'reference_values'
    id: Mapped[int] = mapped_column(primary_key=True)
    ym: Mapped[str] = mapped_column(String(7))
    metric: Mapped[str] = mapped_column(String(32))
    value: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    note: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (UniqueConstraint('ym', 'metric'),)


class ReviewItem(Base):
    __tablename__ = 'review_items'
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(64))
    value: Mapped[str] = mapped_column(String(128))
    where_text: Mapped[str] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    resolved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class Setting(Base):
    __tablename__ = 'settings'
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class AuditLog(Base):
    """Журнал изменений: только добавление."""
    __tablename__ = 'audit_log'
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    user_name: Mapped[str] = mapped_column(String(128))
    entity: Mapped[str] = mapped_column(String(32))
    entity_key: Mapped[str] = mapped_column(String(32))
    field: Mapped[str] = mapped_column(String(128))
    before: Mapped[str | None] = mapped_column(Text)
    after: Mapped[str | None] = mapped_column(Text)
