/**
 * Role-based border colors for message left borders.
 */
export const ROLE_COLORS = {
    user: '#2B95D6',
    worker: '#238551',
    reviewer: '#D9822B',
    outer: '#7157D9',
};

export const ASSISTANT_TEXT_STYLE = {
    padding: '12px 16px',
};

export const SYSTEM_CONTAINER_STYLE = (borderColor) => ({
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '12px',
    borderLeft: `4px solid ${borderColor}`,
});

export const SYSTEM_TEXT_STYLE = {
    fontStyle: 'italic',
    color: '#5f6b7c',
    fontSize: '13px',
};

export const USER_CARD_STYLE = (borderColor) => ({
    maxWidth: '70%',
    padding: '12px 16px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    borderLeft: `4px solid ${borderColor}`,
});
