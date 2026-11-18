SELECT 'enum_OrderStatus_tem_SAIU_PARA_ENTREGA',
       EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='OrderStatus' AND e.enumlabel='SAIU_PARA_ENTREGA'),
       'valor novo do enum presente';
