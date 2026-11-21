import type { EditorStatus } from './status';

const authLabels = {
	ready: 'GitHub 已授权',
	clerk_only: '连接 GitHub',
	reauthorize_required: '重新授权 GitHub',
	login_changed: '请重新连接创建草稿的 GitHub 账号',
	error: '无法检查授权',
};

const workspaceLabels = {
	absent: '无工作区',
	editing: '草稿编辑中',
	submitted: '已提交审核',
	cleaning: '正在清理',
	cleanup_pending: '清理待重试',
};

const prLabels = {
	none: '尚未提交审核',
	open: '待审核',
	merged: '已合并',
	closed: '已关闭',
	unknown: '待确认状态',
	error: '查询失败',
};

export function statusLabels(status: EditorStatus | null, request: 'loading' | 'signed_out' | 'error' | 'ready') {
	if (!status) {
		const auth = { loading: '正在检查登录状态', signed_out: '未登录', error: '无法获取状态', ready: '待确认' };
		return { auth: auth[request], content: '待确认', workspace: '待确认', github: '待确认', pullRequest: '待确认' };
	}
	const { content, github, pullRequest, workspace } = status;
	const commit = { none: '尚无 commit', synced: 'commit 已同步', pending: 'commit 待重试' }[github.commit];
	const branch = { unconfirmed: '分支待确认', ready: '分支已创建', changed_externally: '分支有外部修改' }[github.branch];
	return {
		auth: authLabels[status.auth],
		content: [
			content.published === 'ready' ? 'GitHub 内容索引可用' : content.published === 'error' ? '无法读取 GitHub 内容索引' : '缺少 GitHub 内容索引',
			content.draft === 'ready' ? '数据库有用户草稿' : content.draft === 'error' ? '无法读取用户草稿' : '无用户草稿',
		].join(' · '),
		workspace: workspaceLabels[workspace.status],
		github: [github.fork === 'ready' ? 'fork 已确认' : 'fork 待确认', branch, commit].join(' · '),
		pullRequest: ('number' in pullRequest ? `PR #${pullRequest.number} ` : '') + prLabels[pullRequest.status],
	};
}
