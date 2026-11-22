import React, { useState } from 'react';
import { Sparkles, Play, Copy, Check, ArrowRight, Shield, Cpu, Zap, Code } from 'lucide-react';
import { RolePersona } from '../types';
import { SYSTEM_ROLES } from '../data/roles';
import { SUPREMEAI_MODELS } from '../data/models';
import { env } from '../config/env';
import { useI18n } from '../utils/i18n';
import { getWorkspaceAuthHeaders } from '../utils/workspaceAuth';

interface RoleLabProps {
  onSelectRoleForChat: (role: RolePersona, customInstruction?: string) => void;
  onNavigateToChat: () => void;
}

export const RoleLab: React.FC<RoleLabProps> = ({ onSelectRoleForChat, onNavigateToChat }) => {
  const { t } = useI18n();
  const [selectedRole, setSelectedRole] = useState<RolePersona>(SYSTEM_ROLES[0]);
  const [testPrompt, setTestPrompt] = useState(selectedRole.quickPrompts[0]);
  const [testInstruction, setTestInstruction] = useState(selectedRole.systemInstruction);
  const [testModel, setTestModel] = useState<string>(selectedRole.suggestedModel);
  const [testResponse, setTestResponse] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSelectRole = (role: RolePersona) => {
    setSelectedRole(role);
    setTestPrompt(role.quickPrompts[0] || '');
    setTestInstruction(role.systemInstruction);
    setTestModel(role.suggestedModel);
    setTestResponse('');
  };

  const runTestInference = async () => {
    if (!testPrompt.trim() || isLoading) return;
    setIsLoading(true);
    setTestResponse('');

    try {
      // বাংলা মন্তব্য: ব্যাকএন্ড অথেনটিকেশন ও অ্যাডমিন/ইউজার টিয়ার যাচাইয়ের জন্য টোকেন হেডার যুক্ত করা হয়েছে।
      const adminToken =
        typeof sessionStorage !== 'undefined'
          ? sessionStorage.getItem('supremeai_admin_token')
          : null;
      const headers = getWorkspaceAuthHeaders({
        'Content-Type': 'application/json',
        ...(adminToken ? { 'X-Admin-Token': adminToken } : {}),
      });
      const response = await fetch(`${env.apiBaseUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: testModel,
          systemInstruction: testInstruction,
          messages: [{ role: 'user', content: testPrompt }],
          stream: false,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Inference error');
      }
      setTestResponse(data.text);
    } catch (err: unknown) {
      setTestResponse(
        err instanceof Error
          ? `Error: ${err.message}`
          : 'Unable to complete inference. Verify backend server and API key.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyToStudio = () => {
    onSelectRoleForChat(selectedRole, testInstruction);
    onNavigateToChat();
  };

  const copyResponse = () => {
    if (!testResponse) return;
    navigator.clipboard.writeText(testResponse);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getRoleIcon = (roleId: string) => {
    switch (roleId) {
      case 'supreme-architect':
        return <Cpu className="w-4 h-4" />;
      case 'supreme-fullstack':
        return <Code className="w-4 h-4" />;
      case 'supreme-fast-dev':
        return <Zap className="w-4 h-4" />;
      case 'supreme-security':
        return <Shield className="w-4 h-4" />;
      default:
        return <Sparkles className="w-4 h-4" />;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl mx-auto space-y-8 text-slate-800 dark:text-slate-200">
      {/* Editorial Header */}
      <div className="space-y-1.5 border-b border-slate-200 dark:border-slate-800 pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t.roleLabTitle}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">{t.roleLabSubtitle}</p>
      </div>

      {/* Role Preset Selector Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {SYSTEM_ROLES.map((role) => {
          const isSelected = role.id === selectedRole.id;
          return (
            <button
              key={role.id}
              type="button"
              onClick={() => handleSelectRole(role)}
              className={`p-3.5 text-left rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                  : 'bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700/80 text-slate-800 dark:text-slate-200'
              }`}
            >
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`p-1.5 rounded-md ${
                      isSelected
                        ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {getRoleIcon(role.id)}
                  </div>
                  <span className="font-semibold text-xs truncate">{role.name}</span>
                </div>
                <p
                  className={`text-[11px] line-clamp-2 leading-relaxed ${
                    isSelected ? 'opacity-85' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {role.tagline}
                </p>
              </div>
              <div
                className={`mt-3 pt-2 text-[10px] font-mono border-t ${
                  isSelected
                    ? 'border-slate-700 dark:border-slate-200 opacity-90'
                    : 'border-slate-100 dark:border-slate-700/60 text-slate-400'
                }`}
              >
                {t.modelLabel}{' '}
                {SUPREMEAI_MODELS.find((m) => m.id === role.suggestedModel)?.name ||
                  role.suggestedModel}
              </div>
            </button>
          );
        })}
      </div>

      {/* 2-Column Playground: Configuration Left / Execution Right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Column: Instruction & Model configuration */}
        <div className="bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-4 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 pb-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t.promptSpecTitle}
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{t.modelLabel}</span>
              <select
                value={testModel}
                onChange={(e) => setTestModel(e.target.value)}
                className="text-xs py-1 px-2 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 focus:outline-none"
              >
                {SUPREMEAI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.latencyRating})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              {t.systemInstructionLabel}
            </label>
            <textarea
              rows={6}
              value={testInstruction}
              onChange={(e) => setTestInstruction(e.target.value)}
              className="w-full p-3 font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400 leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              {t.testUserPromptLabel}
            </label>
            <textarea
              rows={3}
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              className="w-full p-3 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400 leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleApplyToStudio}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              <span>{t.useInStudioChatBtn}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={runTestInference}
              disabled={isLoading || !testPrompt.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 rounded-md transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isLoading ? t.runningLabel : t.runTestBtn}</span>
            </button>
          </div>
        </div>

        {/* Right Column: Execution Output */}
        <div className="bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3 min-h-[360px] flex flex-col shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 pb-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t.modelOutputPreviewTitle}
            </h2>
            {testResponse && (
              <button
                type="button"
                onClick={copyResponse}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600">{t.copiedBtn}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>{t.copyBtn}</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="flex-1 bg-slate-50 dark:bg-slate-900 rounded-lg p-4 font-mono text-xs overflow-y-auto whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-800">
            {isLoading ? (
              <div className="flex items-center gap-2 text-slate-400 py-6 justify-center">
                <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" />
                <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]" />
                <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]" />
                <span className="text-xs">
                  {testModel} · {t.runningLabel}
                </span>
              </div>
            ) : testResponse ? (
              testResponse
            ) : (
              <div className="text-slate-400 dark:text-slate-500 text-center py-12 font-sans text-xs">
                {t.roleLabEmptyOutput}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
