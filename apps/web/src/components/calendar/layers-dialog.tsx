'use client';

import { Layers } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { CALENDAR_LAYERS, type CalendarLayer } from '@madar/shared';
import { Button, LayerToggle, Modal, type CalendarLayerKind } from '@madar/ui';

const layerKind: Record<CalendarLayer, CalendarLayerKind | 'holiday'> = {
  tasks: 'task',
  plan: 'plan',
  meetings: 'meeting',
  projects: 'project',
  periods: 'period',
  holidays: 'holiday',
};

/** «لایه‌ها»: each layer on or off. */
export function LayersDialog({
  layers,
  others = false,
  onChange,
}: {
  layers: CalendarLayer[];
  /** Someone else's calendar: their daily plan is not shown at all. */
  others?: boolean;
  onChange: (layers: CalendarLayer[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t('calendar.layersTitle')}
      trigger={
        <Button variant="secondary" icon={<Layers aria-hidden />}>
          {t('calendar.layersButton')}
        </Button>
      }
    >
      <div className="flex flex-col">
        {CALENDAR_LAYERS.filter((layer) => !(others && layer === 'plan')).map((layer) => (
          <LayerToggle
            key={layer}
            layer={layerKind[layer]}
            label={t(`calendar.layers.${layer}`)}
            checked={layers.includes(layer)}
            onChange={(checked) =>
              onChange(CALENDAR_LAYERS.filter((l) => (l === layer ? checked : layers.includes(l))))
            }
          />
        ))}
        {others && <p className="px-3 pt-2 text-sm text-ink-subtle">{t('calendar.planOthers')}</p>}
      </div>
    </Modal>
  );
}
