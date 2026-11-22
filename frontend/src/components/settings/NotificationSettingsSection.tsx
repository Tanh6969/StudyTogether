import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import {
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationSettings,
} from '../../lib/notification.api';
import { ToggleSwitch } from './ToggleSwitch';
import { SettingsSection } from './SettingsSection';

const OPTIONS: { key: keyof NotificationSettings; label: string; hint: string }[] = [
  {
    key: 'enable_group',
    label: 'Thông báo Nhóm học',
    hint: 'Tài liệu mới, phòng học trực tuyến và lời mời nhóm.',
  },
  {
    key: 'enable_goal',
    label: 'Nhắc nhở Mục tiêu hàng ngày',
    hint: 'Nhắc bạn thực hiện mục tiêu học tập mỗi ngày.',
  },
];

export const NotificationSettingsSection: React.FC = () => {
  const [settings, setSettings] = useState<NotificationSettings>({
    enable_forum: true,
    enable_group: true,
    enable_goal: true,
    enable_message: true,
    enable_sound: true,
  });

  useEffect(() => {
    void getNotificationSettings()
      .then((data) => {
        if (data) setSettings(data);
      })
      .catch(() => {});
  }, []);

  const handleToggle = async (key: keyof NotificationSettings, val: boolean) => {
    const previous = settings;
    setSettings({ ...settings, [key]: val });
    try {
      await updateNotificationSettings({ [key]: val });
    } catch {
      // Revert if API fails
      setSettings(previous);
    }
  };

  return (
    <SettingsSection id="notifications" icon={Bell} title="Thông báo" description="Chọn những thông báo bạn muốn nhận.">
      <ul className="m-0 flex list-none flex-col divide-y divide-slate-100 p-0">
        {OPTIONS.map(({ key, label, hint }) => (
          <li key={key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div id={`notif-${key}`} className="text-sm font-semibold text-[#0B1C30]">{label}</div>
              <p className="m-0 mt-0.5 text-[13px] leading-5 text-[#444651]">{hint}</p>
            </div>
            <ToggleSwitch
              checked={settings[key]}
              labelledBy={`notif-${key}`}
              onChange={(v) => void handleToggle(key, v)}
            />
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
};
