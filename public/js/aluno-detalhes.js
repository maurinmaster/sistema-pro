// Visualizador do Dossiê 360° do Aluno e Gestão Contratual / Matrículas
const AlunoDetalhesModule = {
    currentAlunoId: null,
    currentMatricula: null,
    currentData: null,
    currentAvaliacao: null,
    planosCache: [],
    rpgFormState: { apto_sparring: null, criterios: {} },
    rpgCompareId: null,
    rpgExpandedEvalId: null,

    init() {
        // Tab switching no Dossiê
        document.querySelectorAll('.dossier-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetTab = e.currentTarget.getAttribute('data-tab');
                this.switchTab(targetTab);
            });
        });

        this.bindContractEvents();
        this.bindAvaliacaoEvents();

        const dossieAvatarEl = document.getElementById('dossie-avatar');
        if (dossieAvatarEl) {
            dossieAvatarEl.addEventListener('click', () => {
                const aluno = this.currentData?.aluno;
                if (!aluno) return;
                const formattedNome = window.AlunosModule?.formatNomeDisplay
                    ? AlunosModule.formatNomeDisplay(aluno.nome_completo)
                    : (aluno.nome_completo || 'Aluno');
                const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(formattedNome)}&background=0284c7&color=fff&size=512`;
                const fotoSegura = UI.getSafeImageUrl(aluno.foto_perfil_url, '');
                UI.openPhotoLightbox(fotoSegura || fallbackAvatar, formattedNome, {
                    isFallback: !fotoSegura,
                    fallbackUrl: fallbackAvatar
                });
            });
        }
    },

    bindAvaliacaoEvents() {
        const formAvaliacao = document.getElementById('form-avaliacao-graduacao');
        if (formAvaliacao) {
            formAvaliacao.addEventListener('submit', (e) => this.submitAvaliacao(e));
        }

        const btnAprovar = document.getElementById('btn-aprovar-promocao');
        if (btnAprovar) {
            btnAprovar.addEventListener('click', () => this.aprovarPromocao());
        }

        // Formulário e controles da Avaliação Técnica RPG (Muay Thai)
        const formDesempenho = document.getElementById('form-avaliacao-desempenho');
        if (formDesempenho) {
            formDesempenho.addEventListener('submit', (e) => this.submitAvaliacaoDesempenho(e));
        }

        document.getElementById('btn-sparring-sim')?.addEventListener('click', () => this.setRpgAptoSparring(true));
        document.getElementById('btn-sparring-nao')?.addEventListener('click', () => this.setRpgAptoSparring(false));
        document.getElementById('btn-rpg-carregar-ultima')?.addEventListener('click', () => this.carregarUltimaRpgNoFormulario());

        const criteriosContainer = document.getElementById('rpg-criterios-container');
        if (criteriosContainer) {
            criteriosContainer.addEventListener('click', (e) => {
                const segBtn = e.target.closest('.rpg-seg-btn[data-criterion-id]');
                if (!segBtn || segBtn.disabled) return;
                const criterionId = segBtn.getAttribute('data-criterion-id');
                const val = Number(segBtn.getAttribute('data-val'));
                this.setRpgCriterionScore(criterionId, val);
            });
        }
    },

    bindContractEvents() {
        // Formulário Trancar Matrícula
        const formTrancar = document.getElementById('form-trancar-matricula');
        if (formTrancar) {
            formTrancar.addEventListener('submit', (e) => this.submitTrancarMatricula(e));
        }

        const selectMotivoTrancar = document.getElementById('trancar-motivo-select');
        const groupCustomMotivo = document.getElementById('trancar-motivo-custom-group');
        if (selectMotivoTrancar && groupCustomMotivo) {
            selectMotivoTrancar.addEventListener('change', (e) => {
                groupCustomMotivo.style.display = e.target.value === 'Outro' ? 'block' : 'none';
            });
        }

        // Formulário Trocar Plano (Upgrade / Downgrade)
        const formTrocar = document.getElementById('form-trocar-plano');
        if (formTrocar) {
            formTrocar.addEventListener('submit', (e) => this.submitTrocarPlano(e));
        }

        // Listener reativo ao mudar o novo plano no modal de troca
        const selectNovoPlano = document.getElementById('troca-novo-plano-id');
        if (selectNovoPlano) {
            selectNovoPlano.addEventListener('change', (e) => {
                this.updateTrocaPlanoPreview(e.target.value);
            });
        }

        // Formulário Cancelar Matrícula
        const formCancelar = document.getElementById('form-cancelar-matricula');
        if (formCancelar) {
            formCancelar.addEventListener('submit', (e) => this.submitCancelarMatricula(e));
        }

        // Formulário Destrancar Matrícula
        const formDestrancar = document.getElementById('form-destrancar-matricula');
        if (formDestrancar) {
            formDestrancar.addEventListener('submit', (e) => this.submitDestrancarMatricula(e));
        }

        // Formulário Nova Matrícula no Dossiê
        const formNovaMat = document.getElementById('form-nova-matricula-aluno');
        if (formNovaMat) {
            formNovaMat.addEventListener('submit', (e) => this.submitNovaMatricula(e));
        }

        const selectNovaMatPlano = document.getElementById('nova-mat-plano-id');
        if (selectNovaMatPlano) {
            selectNovaMatPlano.addEventListener('change', (e) => {
                const plano = this.planosCache.find(p => p.id == e.target.value);
                if (plano) {
                    document.getElementById('nova-mat-valor').value = parseFloat(plano.valor_mensal).toFixed(2);
                }
            });
        }

        // Formulário Avaliação de Aptidão p/ Próximo Nível (Professor)
        const formAptidao = document.getElementById('form-aptidao-professor');
        if (formAptidao) {
            formAptidao.addEventListener('submit', (e) => this.submitAptidaoProfessor(e));
        }
    },

    switchTab(tabId) {
        document.querySelectorAll('.dossier-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.dossier-tab-content').forEach(c => c.classList.remove('active'));

        const targetBtn = document.querySelector(`.dossier-tab-btn[data-tab="${tabId}"]`);
        const targetContent = document.getElementById(`dossier-tab-${tabId}`);

        if (targetBtn) {
            targetBtn.classList.add('active');
            try {
                targetBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            } catch {
                // Ignora em ambientes sem scrollIntoView
            }
        }
        if (targetContent) targetContent.classList.add('active');

        const scrollBody = document.querySelector('#modal-dossie .dossier-scroll-body');
        if (scrollBody) scrollBody.scrollTop = 0;
    },

    async openDossier(id) {
        this.currentAlunoId = id;
        this.switchTab('geral');
        UI.openModal('modal-dossie');

        const tabGeral = document.getElementById('dossier-tab-geral');
        if (tabGeral) {
            tabGeral.innerHTML = `<div style="text-align: center; padding: 60px;"><div class="spinner"></div> Carregando dossiê 360°...</div>`;
        }

        try {
            const [resAluno, resPlanos] = await Promise.all([
                API.get(`/alunos/${id}`),
                API.get('/planos')
            ]);

            this.planosCache = resPlanos.data || [];
            this.renderDossier(resAluno.data);
        } catch (err) {
            if (tabGeral) {
                tabGeral.innerHTML = `<div style="color: #ef4444; padding: 30px; text-align: center;">Erro ao carregar dados do aluno: ${UI.escapeHtml(err.message)}</div>`;
            }
            UI.showToast('Erro ao abrir dossiê: ' + err.message, 'error');
        }
    },

    renderDossier(data) {
        this.currentData = data;
        const { aluno, graduacoes, avaliacoes = [], matricula, faturas, checkins } = data;
        this.currentMatricula = matricula;

        const isMenor = aluno.idade !== null && aluno.idade < 18;
        const safeAlunoId = Number(aluno.id);
        const formattedNome = window.AlunosModule?.formatNomeDisplay
            ? AlunosModule.formatNomeDisplay(aluno.nome_completo)
            : (aluno.nome_completo || '');
        const encodedAlunoNome = encodeURIComponent(formattedNome).replace(/'/g, '%27');

        // Atualiza cabeçalho enxuto do dossiê
        const avatarEl = document.getElementById('dossie-avatar');
        if (avatarEl) {
            const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(formattedNome || 'Aluno')}&background=0284c7&color=fff`;
            avatarEl.src = UI.getSafeImageUrl(aluno.foto_perfil_url, fallbackAvatar);
            avatarEl.title = `Clique para ampliar a foto de ${formattedNome || 'Aluno'}`;
        }
        document.getElementById('dossie-nome').textContent = formattedNome;
        document.getElementById('dossie-meta').innerHTML = `
            ${UI.renderStatusBadge(aluno.status)}
            <span style="white-space: nowrap;">CPF: ${UI.escapeHtml(aluno.cpf || 'Não informado')}</span>
            <span style="white-space: nowrap;">${aluno.idade !== null ? Number(aluno.idade) + ' anos' : 'Idade não inf.'}</span>
            ${isMenor ? '<span class="minor-tag">MENOR</span>' : ''}
            <span style="white-space: nowrap;">Cadastro: ${UI.formatDate(aluno.created_at)}</span>
        `;

        // Links clicáveis seguros de contato
        const phoneDigitsRaw = String(aluno.telefone_whatsapp || '').replace(/\D/g, '');
        const waDigits = phoneDigitsRaw.length >= 10
            ? ((phoneDigitsRaw.length === 10 || phoneDigitsRaw.length === 11) && !phoneDigitsRaw.startsWith('55') ? `55${phoneDigitsRaw}` : phoneDigitsRaw)
            : '';
        const whatsappHtml = waDigits
            ? `<a href="https://wa.me/${waDigits}" target="_blank" rel="noopener noreferrer" class="dossier-contact-link">${UI.escapeHtml(aluno.telefone_whatsapp)}</a>`
            : UI.escapeHtml(aluno.telefone_whatsapp || 'Não informado');

        const emailClean = typeof aluno.email === 'string' ? aluno.email.trim() : '';
        const emailHtml = /^[^\s<>"']+@[^\s<>"']+$/.test(emailClean)
            ? `<a href="mailto:${UI.escapeHtml(emailClean)}" class="dossier-contact-link">${UI.escapeHtml(emailClean)}</a>`
            : UI.escapeHtml(emailClean || 'Não informado');

        // TAB 1: GERAL & SAÚDE
        document.getElementById('dossier-tab-geral').innerHTML = `
            <div class="dossier-quick-actions">
                ${(!window.AuthModule || AuthModule.can('manage_alunos')) ? `
                    <button type="button" class="btn btn-secondary btn-sm"
                        onclick="UI.closeModal('modal-dossie'); AlunosModule.openEditModal(${safeAlunoId})">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                        <span>Editar Dados</span>
                    </button>
                ` : ''}
                <button type="button" class="btn btn-secondary btn-sm" style="color: #f59e0b; border-color: rgba(245, 158, 11, 0.35);"
                    onclick="AlunosModule.openResetSenhaModal(${safeAlunoId}, '${encodedAlunoNome}')">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3M18.5 4.5l2 2"/></svg>
                    <span>Resetar Senha</span>
                </button>
                ${(!window.AuthModule || AuthModule.can('delete_alunos')) ? `
                    <button type="button" class="btn btn-secondary btn-sm" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.35);"
                        onclick="UI.closeModal('modal-dossie'); AlunosModule.deleteAluno(${safeAlunoId}, '${encodedAlunoNome}')">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        <span>Excluir</span>
                    </button>
                ` : ''}
            </div>

            <div class="form-grid" style="margin-bottom: 18px;">
                <div class="stat-card" style="padding: 16px;">
                    <div class="stat-title">Dados de Contato</div>
                    <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                        <div class="dossier-info-row"><strong>WhatsApp:</strong> ${whatsappHtml}</div>
                        <div class="dossier-info-row"><strong>E-mail:</strong> ${emailHtml}</div>
                        <div class="dossier-info-row"><strong>Gênero:</strong> ${UI.escapeHtml(aluno.genero || 'Não informado')}</div>
                        <div class="dossier-info-row"><strong>Nascimento:</strong> ${UI.formatDate(aluno.data_nascimento)}</div>
                    </div>
                </div>

                <div class="stat-card" style="padding: 16px;">
                    <div class="stat-title">Ficha Médica &amp; Emergência</div>
                    <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                        <div class="dossier-info-row"><strong>Tipo Sanguíneo:</strong> <span style="font-weight: 700; color: #ef4444;">${UI.escapeHtml(aluno.tipo_sanguineo || 'Não registrado')}</span></div>
                        <div class="dossier-info-row"><strong>Emergência:</strong> ${UI.escapeHtml(aluno.contato_emergencia_nome || '-')} (${UI.escapeHtml(aluno.contato_emergencia_fone || '-')})</div>
                        <div class="dossier-info-row"><strong>Histórico / Restrições:</strong></div>
                        <div style="background: rgba(0,0,0,0.25); padding: 8px 12px; border-radius: 6px; font-size: 12px; color: var(--text-secondary); word-break: break-word;">
                            ${UI.escapeHtml(aluno.observacoes_medicas || 'Nenhuma restrição médica ou lesão reportada.')}
                        </div>
                    </div>
                </div>
            </div>

            ${isMenor ? `
                <div class="stat-card" style="padding: 16px; border-color: rgba(245, 158, 11, 0.4); margin-bottom: 12px;">
                    <div class="stat-title" style="color: var(--accent);">Responsável Legal (Obrigatório p/ Menor de Idade)</div>
                    <div class="dossier-resp-grid">
                        <div class="dossier-info-row"><strong>Nome:</strong> ${UI.escapeHtml(aluno.responsavel_nome || '-')}</div>
                        <div class="dossier-info-row"><strong>CPF:</strong> <span style="white-space: nowrap;">${UI.escapeHtml(aluno.responsavel_cpf || 'Não informado')}</span></div>
                        <div class="dossier-info-row"><strong>Telefone:</strong> ${UI.escapeHtml(aluno.responsavel_telefone || '-')}</div>
                    </div>
                </div>
            ` : ''}
        `;

        // TAB 2: GRADUAÇÕES (AVALIAÇÃO ACIMA, HISTÓRICO ABAIXO)
        const canPromote = !window.AuthModule || AuthModule.can('promote_faixas');
        let avaliacoesHtml = '';
        if (avaliacoes.length === 0) {
            avaliacoesHtml = `
                <div style="background: rgba(30, 41, 59, 0.4); border: 1px dashed var(--border-color); border-radius: 12px; padding: 22px; text-align: center; margin-bottom: 22px;">
                    <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">Nenhuma graduação ativa registrada</div>
                    <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">Efetive uma matrícula ou lance a graduação inicial para habilitar as avaliações técnicas.</div>
                    <button class="btn btn-primary btn-sm" onclick="AlunosModule.openPromoModal(${safeAlunoId}, '${encodedAlunoNome}')">
                        Lançar Graduação Inicial
                    </button>
                </div>
            `;
        } else {
            avaliacoesHtml = `
                <div style="margin-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
                        <div>
                            <div style="font-weight: 700; font-size: 15px; color: #ffffff;">Avaliações Técnicas &amp; Faixa Atual</div>
                            <div style="font-size: 12px; color: var(--text-muted);">Toque no card para abrir a ficha de avaliação e pontuar os requisitos.</div>
                        </div>
                        <button class="btn btn-secondary btn-sm" onclick="AlunosModule.openPromoModal(${safeAlunoId}, '${encodedAlunoNome}')">
                            + Nova Graduação Manual
                        </button>
                    </div>

                    <div class="dossier-eval-grid">
                        ${avaliacoes.map(av => {
                            const isApto = av.apto === 1;
                            const pct = Number(av.percentual_obtido || 0);
                            const minPct = Number(av.porcentagem_minima || 70);
                            const safeModId = Number(av.modalidade_id);
                            const safeNivelId = Number(av.graduacao_nivel_id);
                            const safeAlunoGradId = Number(av.aluno_graduacao_id) || 0;
                            const hasNextBelt = !!av.proxima_graduacao;
                            const podeRetroceder = canPromote && Boolean(av.pode_retroceder) && Boolean(av.graduacao_anterior_retrocesso);
                            const retroNome = av.graduacao_anterior_retrocesso?.nome || '';

                            return `
                                <div class="stat-card" style="cursor: pointer; padding: 16px; border-left: 4px solid ${UI.sanitizeColor(av.cor_hex_primaria, '#38bdf8')}; transition: transform 0.2s, box-shadow 0.2s; position: relative;"
                                     onclick="AlunoDetalhesModule.openModalAvaliacao(${safeAlunoId}, ${safeModId}, ${safeNivelId})"
                                     title="Clique na faixa para lançar notas e avaliar">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
                                        <div style="min-width: 0;">
                                            <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">${UI.escapeHtml(av.modalidade_nome)}</span>
                                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
                                                ${UI.renderBeltBadge(av.nivel_nome, av.cor_hex_primaria, av.cor_hex_secundaria)}
                                                <span style="font-weight: 700; font-size: 14px; color: #ffffff;">${UI.escapeHtml(av.nivel_nome)}</span>
                                            </div>
                                        </div>
                                        <div>
                                            ${isApto 
                                                ? `<span class="badge-status ativo" style="font-size: 11px; font-weight: 700;">Apto (${pct}%)</span>` 
                                                : `<span class="badge-status pendente" style="font-size: 11px;">Em Evolução (${pct}%)</span>`
                                            }
                                        </div>
                                    </div>

                                    <!-- Barra de Progresso / Porcentagem -->
                                    <div style="margin-bottom: 12px;">
                                        <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
                                            <span style="color: var(--text-muted);">Aproveitamento dos Requisitos</span>
                                            <span style="font-weight: 700; color: ${isApto ? '#10b981' : '#38bdf8'};">${pct}% <span style="font-weight: 400; color: var(--text-muted);">(Mín: ${minPct}%)</span></span>
                                        </div>
                                        <div style="width: 100%; height: 7px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden;">
                                            <div style="width: ${Math.min(pct, 100)}%; height: 100%; background: ${isApto ? 'linear-gradient(90deg, #10b981, #059669)' : 'linear-gradient(90deg, #38bdf8, #2563eb)'}; border-radius: 999px; transition: width 0.3s;"></div>
                                        </div>
                                    </div>

                                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--text-secondary); border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; margin-top: 10px;">
                                        <div>
                                            <strong>${Number(av.total_itens) || 0}</strong> requisitos • ${Number(av.total_pontos_obtidos) || 0}/${Number(av.total_pontos_possiveis) || ((Number(av.total_itens) || 0) * 5)} pts
                                        </div>
                                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                            <button type="button" class="btn btn-secondary btn-sm" style="padding: 6px 12px; min-height: 36px; font-size: 12px;"
                                                onclick="event.stopPropagation(); AlunoDetalhesModule.openModalAvaliacao(${safeAlunoId}, ${safeModId}, ${safeNivelId})">
                                                Lançar Notas
                                            </button>
                                            ${isApto && hasNextBelt ? `
                                                <button type="button" class="btn btn-success btn-sm" style="padding: 6px 12px; min-height: 36px; font-size: 12px; font-weight: 700;"
                                                    onclick="event.stopPropagation(); AlunoDetalhesModule.openModalAvaliacao(${safeAlunoId}, ${safeModId}, ${safeNivelId})">
                                                    Promover
                                                </button>
                                            ` : ''}
                                            ${podeRetroceder ? `
                                                <button type="button" class="btn btn-secondary btn-sm" style="padding: 6px 11px; min-height: 36px; font-size: 12px; color: #f59e0b; border-color: rgba(245, 158, 11, 0.35);"
                                                    title="${UI.escapeHtml(`Desfazer promoção e retroceder para "${retroNome}"`)}"
                                                    onclick="event.stopPropagation(); AlunoDetalhesModule.retrocederGraduacao(${safeAlunoId}, ${safeModId}, ${safeAlunoGradId})">
                                                    ↩ Retroceder
                                                </button>
                                            ` : ''}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        const gradTimeline = graduacoes.length === 0 ? `
            <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">
                Nenhum histórico anterior registrado.
            </div>
        ` : `
            <div style="margin-top: 10px;">
                <div style="font-weight: 700; font-size: 14px; color: #ffffff; margin-bottom: 12px;">Histórico de Graduações</div>
                <div class="timeline">
                    ${graduacoes.map(g => {
                        const canRollbackItem = canPromote && g.atual && Boolean(g.pode_retroceder) && Boolean(g.graduacao_anterior_retrocesso);
                        const rollbackTargetNome = g.graduacao_anterior_retrocesso?.nome || '';
                        return `
                        <div class="timeline-item">
                            <div class="timeline-dot" style="border-color: ${UI.sanitizeColor(g.cor_hex_primaria, '#94a3b8')};"></div>
                            <div class="timeline-card">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px 12px;">
                                    <div style="min-width: 0; flex: 1;">
                                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                                            ${UI.renderBeltBadge(g.nivel_nome, g.cor_hex_primaria, g.cor_hex_secundaria)}
                                            ${g.atual ? '<span class="badge-status ativo" style="font-size: 10px; padding: 2px 6px;">Atual</span>' : ''}
                                        </div>
                                        <div style="font-size: 13px; font-weight: 600; color: var(--text-main);">${UI.escapeHtml(g.modalidade_nome)}</div>
                                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
                                            Avaliador: <strong>${UI.escapeHtml(g.professor_avaliador || 'Não Informado')}</strong>
                                        </div>
                                        ${g.observacoes ? `<div style="font-size: 12px; margin-top: 6px; font-style: italic; color: var(--text-secondary); word-break: break-word;">${UI.escapeHtml(g.observacoes)}</div>` : ''}
                                    </div>
                                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
                                        <div style="text-align: right; font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); white-space: nowrap;">
                                            ${UI.formatDate(g.data_graduacao)}
                                        </div>
                                        ${canRollbackItem ? `
                                            <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px; color: #f59e0b; border-color: rgba(245, 158, 11, 0.35);"
                                                title="${UI.escapeHtml(`Desfazer promoção e retroceder para "${rollbackTargetNome}"`)}"
                                                onclick="AlunoDetalhesModule.retrocederGraduacao(${safeAlunoId}, ${Number(g.modalidade_id)}, ${Number(g.id)})">
                                                ↩ Retroceder
                                            </button>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                    }).join('')}
                </div>
            </div>
        `;

        document.getElementById('dossier-tab-graduacoes').innerHTML = avaliacoesHtml + gradTimeline;

        // TAB 3: MATRÍCULA & HISTÓRICO FINANCEIRO
        let contractActionsHtml = '';
        let contractAlertHtml = '';

        if (matricula && matricula.status === 'ativa') {
            const safeMatId = Number(matricula.id);
            const safePlanoId = Number(matricula.plano_id);
            const encodedPlanoNome = encodeURIComponent(matricula.plano_nome || '').replace(/'/g, '%27');
            contractActionsHtml = `
                <div class="dossier-actions-row">
                    <button class="btn btn-secondary btn-sm" onclick="AlunoDetalhesModule.openModalTrocarPlano(${safeMatId}, ${safePlanoId}, decodeURIComponent('${encodedPlanoNome}'), ${Number(matricula.valor_acordado) || 0})">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#38bdf8" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                        <span>Trocar Plano</span>
                    </button>
                    <button class="btn btn-secondary btn-sm" style="color: #f59e0b; border-color: rgba(245, 158, 11, 0.3);" onclick="AlunoDetalhesModule.openModalTrancarMatricula(${safeMatId})">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><rect width="4" height="8" x="9" y="8" rx="1"/><rect width="4" height="8" x="15" y="8" rx="1"/></svg>
                        <span>Trancar Matrícula</span>
                    </button>
                    <button class="btn btn-secondary btn-sm" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3);" onclick="AlunoDetalhesModule.openModalCancelarMatricula(${safeMatId})">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                        <span>Cancelar Contrato</span>
                    </button>
                </div>
            `;
        } else if (matricula && matricula.status === 'trancada') {
            const safeMatId = Number(matricula.id);
            contractAlertHtml = `
                <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 12px; margin-top: 12px; font-size: 13px; color: #fde68a;">
                    <strong>Matrícula Trancada:</strong> ${UI.escapeHtml(matricula.motivo_cancelamento_trancamento || 'Motivo não especificado')}
                    ${matricula.data_retorno_prevista ? `<br><span style="font-size: 11px;">Retorno previsto: <strong>${UI.formatDate(matricula.data_retorno_prevista)}</strong></span>` : ''}
                </div>
            `;
            contractActionsHtml = `
                <div class="dossier-actions-row">
                    <button class="btn btn-success btn-sm" onclick="AlunoDetalhesModule.openModalDestrancar(${safeMatId})">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        <span>Destrancar / Reativar</span>
                    </button>
                    <button class="btn btn-secondary btn-sm" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3);" onclick="AlunoDetalhesModule.openModalCancelarMatricula(${safeMatId})">
                        <span>Cancelar Definitivamente</span>
                    </button>
                </div>
            `;
        } else {
            contractAlertHtml = `
                <div style="background: rgba(255, 255, 255, 0.03); border: 1px dashed var(--border-color); border-radius: 8px; padding: 14px; margin-top: 12px; text-align: center; color: var(--text-muted); font-size: 13px;">
                    Este aluno não possui um contrato ativo no momento.
                </div>
            `;
            contractActionsHtml = `
                <div class="dossier-actions-row" style="justify-content: flex-end;">
                    <button class="btn btn-primary btn-sm" onclick="AlunoDetalhesModule.openModalNovaMatricula(${safeAlunoId})">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                        <span>Contratar Novo Plano</span>
                    </button>
                </div>
            `;
        }

        const statusColors = { pago: '#10b981', pendente: '#f59e0b', atrasado: '#ef4444', cancelado: '#94a3b8' };
        const fatHtml = faturas.length === 0 ? `
            <div style="text-align: center; padding: 30px; color: var(--text-muted);">Nenhuma fatura registrada.</div>
        ` : `
            <div class="table-responsive dossier-desktop-table">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Competência</th>
                            <th>Vencimento</th>
                            <th>Valor</th>
                            <th>Status</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${faturas.map(f => `
                            <tr>
                                <td style="font-family: var(--font-mono); font-weight: 700;">${UI.escapeHtml(f.competencia)}</td>
                                <td>${UI.formatDate(f.data_vencimento)}</td>
                                <td style="font-weight: 700;">${UI.formatCurrency(f.valor_original)}</td>
                                <td>
                                    <span style="color: ${statusColors[f.status] || '#94a3b8'}; font-weight: 700; text-transform: uppercase; font-size: 11px;">
                                        ${UI.escapeHtml(f.status)}
                                    </span>
                                </td>
                                <td>
                                    ${f.status !== 'pago' && f.status !== 'cancelado' ? `
                                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                            <button class="btn btn-success" style="padding: 6px 12px; font-size: 11px;" onclick="AlunoDetalhesModule.darBaixaFatura(${Number(f.id)})">
                                                Confirmar Pagamento
                                            </button>
                                            ${f.asaas_payment_id ? `<span class="fatura-gateway-pending" title="Cobrança aberta no gateway Asaas">Asaas</span>` : ''}
                                        </div>
                                    ` : (f.status === 'pago' ? `
                                        <span class="fatura-origem-badge ${f.origem_pagamento === 'online' ? 'origem-online' : 'origem-manual'}">
                                            ${f.origem_pagamento === 'online' ? 'Gateway' : 'Manual'} • ${UI.escapeHtml(String(f.metodo_pagamento || 'Pago').replace(/_/g, ' '))}
                                        </span>
                                    ` : `
                                        <span style="font-size: 11px; color: var(--text-muted);">Cancelada</span>
                                    `)}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="dossier-mobile-list">
                ${faturas.map(f => `
                    <div class="dossier-mobile-card">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <span style="font-family: var(--font-mono); font-weight: 700; color: #ffffff; font-size: 14px;">${UI.escapeHtml(f.competencia)}</span>
                            <span style="color: ${statusColors[f.status] || '#94a3b8'}; font-weight: 700; text-transform: uppercase; font-size: 11px;">
                                ${UI.escapeHtml(f.status)}
                            </span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">
                            <span style="font-size: 12px; color: var(--text-muted);">Venc.: ${UI.formatDate(f.data_vencimento)}</span>
                            <strong style="font-size: 16px; color: #38bdf8;">${UI.formatCurrency(f.valor_original)}</strong>
                        </div>
                        ${f.status !== 'pago' && f.status !== 'cancelado' ? `
                            <button class="btn btn-success btn-sm" style="width: 100%; min-height: 40px; justify-content: center;" onclick="AlunoDetalhesModule.darBaixaFatura(${Number(f.id)})">
                                Confirmar Pagamento${f.asaas_payment_id ? ' (Asaas aberto)' : ''}
                            </button>
                        ` : (f.status === 'pago' ? `
                            <div style="font-size: 11.5px;">
                                <span class="fatura-origem-badge ${f.origem_pagamento === 'online' ? 'origem-online' : 'origem-manual'}">
                                    ${f.origem_pagamento === 'online' ? 'Gateway' : 'Manual'} • ${UI.escapeHtml(String(f.metodo_pagamento || 'Pago').replace(/_/g, ' '))}
                                </span>
                            </div>
                        ` : `
                            <div style="font-size: 11.5px; color: var(--text-muted);">Forma: Cancelada</div>
                        `)}
                    </div>
                `).join('')}
            </div>
        `;

        document.getElementById('dossier-tab-financeiro').innerHTML = `
            <div class="stat-card" style="padding: 16px; margin-bottom: 18px;">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <div class="stat-title" style="margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Contrato / Matrícula Atual</div>
                    ${matricula ? UI.renderStatusBadge(matricula.status) : ''}
                </div>
                <div class="dossier-contract-grid">
                    <div><span style="font-size: 11px; color: var(--text-muted); display: block;">Plano:</span><strong style="color: var(--text-main); font-size: 14px;">${matricula ? UI.escapeHtml(matricula.plano_nome) : 'Nenhum'}</strong></div>
                    <div><span style="font-size: 11px; color: var(--text-muted); display: block;">Valor Acordado:</span><strong style="color: #38bdf8; font-size: 14px;">${matricula ? UI.formatCurrency(matricula.valor_acordado) : '-'}</strong></div>
                    <div><span style="font-size: 11px; color: var(--text-muted); display: block;">Vencimento:</span><strong>Dia ${matricula ? Number(matricula.dia_vencimento) : '-'}</strong></div>
                    <div><span style="font-size: 11px; color: var(--text-muted); display: block;">Início:</span><span>${matricula ? UI.formatDate(matricula.data_inicio) : '-'}</span></div>
                </div>
                ${contractAlertHtml}
                ${contractActionsHtml}
            </div>
            <h4 style="font-family: var(--font-heading); margin-bottom: 10px;">Histórico de Mensalidades</h4>
            <div class="table-card">${fatHtml}</div>
        `;

        // TAB 4: PRESENÇAS / CHECK-INS
        const chkHtml = checkins.length === 0 ? `
            <div style="text-align: center; padding: 36px; color: var(--text-muted);">Nenhum check-in registrado recentemente.</div>
        ` : `
            <div class="table-responsive dossier-desktop-table">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Data e Horário</th>
                            <th>Modalidade</th>
                            <th>Turma</th>
                            <th>Método</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${checkins.map(c => `
                            <tr>
                                <td style="font-family: var(--font-mono);">${UI.formatDateTime(c.data_hora_checkin)}</td>
                                <td><strong style="color: var(--primary-light);">${UI.escapeHtml(c.modalidade_nome)}</strong></td>
                                <td>${UI.escapeHtml(c.turma_nome || 'Treino Livre')}</td>
                                <td style="text-transform: capitalize; font-size: 12px;">${UI.escapeHtml((c.metodo || '').replace('_', ' '))}</td>
                                <td><span class="badge-status ${c.status === 'aprovado' ? 'ativo' : 'bloqueado'}">${UI.escapeHtml(c.status)}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="dossier-mobile-list">
                ${checkins.map(c => `
                    <div class="dossier-mobile-card">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <span style="font-family: var(--font-mono); font-size: 12.5px; color: #ffffff; font-weight: 700;">${UI.formatDateTime(c.data_hora_checkin)}</span>
                            <span class="badge-status ${c.status === 'aprovado' ? 'ativo' : 'bloqueado'}">${UI.escapeHtml(c.status)}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12.5px;">
                            <strong style="color: var(--primary-light);">${UI.escapeHtml(c.modalidade_nome || 'Modalidade')}</strong>
                            <span style="color: var(--text-muted);">${UI.escapeHtml(c.turma_nome || 'Treino Livre')}</span>
                        </div>
                        <div style="font-size: 11.5px; color: var(--text-muted); text-transform: capitalize;">
                            Método: ${UI.escapeHtml((c.metodo || '').replace('_', ' '))}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        document.getElementById('dossier-tab-presencas').innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 14px;">
                <h4 style="font-family: var(--font-heading); margin: 0;">Últimas 30 Presenças</h4>
                <button class="btn btn-primary btn-sm" style="min-height: 38px;" onclick="CheckinsModule.quickCheckin(${safeAlunoId})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
                    <span>Novo Check-in</span>
                </button>
            </div>
            <div class="table-card">${chkHtml}</div>
        `;

        // TAB 5: AVALIAÇÃO TÉCNICA GAMIFICADA (ESTILO RPG - MUAY THAI)
        this.rpgExpandedEvalId = null;
        const rpgHistInit = data.avaliacao_rpg?.historico || [];
        this.rpgCompareId = rpgHistInit[1] ? Number(rpgHistInit[1].id) : null;
        this.renderDesempenhoRpgTab(data, safeAlunoId, encodedAlunoNome);
    },

    onChangeRpgCompare(compareIdStr) {
        this.rpgCompareId = compareIdStr ? Number(compareIdStr) : null;
        if (!this.currentData) return;
        const safeAlunoId = Number(this.currentData.aluno?.id || this.currentAlunoId);
        const encodedAlunoNome = encodeURIComponent(this.currentData.aluno?.nome_completo || 'Aluno').replace(/'/g, '%27');
        this.renderDesempenhoRpgTab(this.currentData, safeAlunoId, encodedAlunoNome);
    },

    toggleRpgEvalDetails(evalId) {
        const numId = Number(evalId);
        this.rpgExpandedEvalId = this.rpgExpandedEvalId === numId ? null : numId;
        if (!this.currentData) return;
        const safeAlunoId = Number(this.currentData.aluno?.id || this.currentAlunoId);
        const encodedAlunoNome = encodeURIComponent(this.currentData.aluno?.nome_completo || 'Aluno').replace(/'/g, '%27');
        this.renderDesempenhoRpgTab(this.currentData, safeAlunoId, encodedAlunoNome);
    },

    openRpgStatusCard() {
        if (!this.currentData || typeof window.RpgAvaliacaoUI === 'undefined') return;
        const rpgHist = (this.currentData.avaliacao_rpg && Array.isArray(this.currentData.avaliacao_rpg.historico))
            ? this.currentData.avaliacao_rpg.historico
            : (this.currentData.avaliacoes_desempenho || []).filter(d => d.is_rpg || d.modelo_avaliacao === 'rpg');
        const atual = rpgHist[0] || null;
        if (!atual) {
            UI.showToast('Registre uma avaliação RPG antes de gerar o card.', 'warning');
            return;
        }
        let anterior = null;
        if (this.rpgCompareId) {
            anterior = rpgHist.find(h => Number(h.id) === Number(this.rpgCompareId) && Number(h.id) !== Number(atual.id)) || null;
        }
        const aluno = this.currentData.aluno || {};
        const grads = Array.isArray(this.currentData.graduacoes) ? this.currentData.graduacoes : [];
        const gradAtiva = grads.find(g => (g.atual === 1 || g.atual === true) && (g.modalidade_nome || '').toLowerCase().includes('muay'))
            || grads.find(g => g.atual === 1 || g.atual === true)
            || grads[0]
            || null;
        const gradNome = gradAtiva
            ? `${gradAtiva.modalidade_nome ? gradAtiva.modalidade_nome + ' • ' : ''}${gradAtiva.nivel_nome || 'Atleta'}`
            : 'Muay Thai • Atleta';

        window.RpgAvaliacaoUI.openStatusCardModal({
            alunoNome: aluno.nome_completo || 'Atleta',
            fotoUrl: aluno.foto_perfil_url || null,
            graduacaoNome: gradNome,
            corPrimaria: gradAtiva?.cor_hex_primaria || '#ffffff',
            corSecundaria: gradAtiva?.cor_hex_secundaria || '#0f172a',
            atual,
            anterior,
            academiaNome: 'PRO COMBATE'
        });
    },

    renderDesempenhoRpgTab(data, safeAlunoId, encodedAlunoNome) {
        const desTabEl = document.getElementById('dossier-tab-desempenho');
        if (!desTabEl) return;

        const rpgUI = window.RpgAvaliacaoUI;
        const desList = data.avaliacoes_desempenho || [];
        const rpgHistory = (data.avaliacao_rpg && Array.isArray(data.avaliacao_rpg.historico))
            ? data.avaliacao_rpg.historico
            : desList.filter(d => d.is_rpg || d.modelo_avaliacao === 'rpg');

        const atual = rpgHistory[0] || null;
        let anterior = null;
        if (this.rpgCompareId) {
            anterior = rpgHistory.find(h => Number(h.id) === Number(this.rpgCompareId) && (!atual || Number(h.id) !== Number(atual.id))) || null;
        } else if (rpgHistory[1] && this.rpgCompareId === undefined) {
            anterior = rpgHistory[1];
        }

        const deltas = atual && anterior && rpgUI ? rpgUI.computeDeltas(atual, anterior) : null;
        const requisitosExame = data.avaliacao_rpg?.requisitos_exame || null;

        let heroHtml = '';
        if (atual && rpgUI) {
            const compareOptions = rpgHistory
                .filter(h => Number(h.id) !== Number(atual.id))
                .map(h => `<option value="${Number(h.id)}" ${Number(this.rpgCompareId) === Number(h.id) ? 'selected' : ''}>${UI.escapeHtml(UI.formatDate(h.data_avaliacao))} • Rank ${UI.escapeHtml(h.rank_combate)} (${Number(h.score_total)}/100)</option>`)
                .join('');

            const arquetipoObj = atual.arquetipo || rpgUI.computeArchetype(atual.pilares, atual.score_total);
            const focoObj = atual.foco_evolucao || rpgUI.computeTrainingFocus(atual.criterios, atual.pilares);
            const badgesArr = (Array.isArray(atual.badges) && atual.badges.length > 0)
                ? atual.badges
                : rpgUI.computeBadges(atual.criterios, Boolean(atual.apto_sparring));

            heroHtml = `
                ${rpgUI.renderFocusMissionCardHtml(focoObj)}

                <div class="rpg-dashboard-grid">
                    <div class="rpg-radar-card">
                        <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <span style="font-size: 11.5px; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em;">Radar de Atributos</span>
                            <span style="font-size: 11px; color: #94a3b8;">${UI.escapeHtml(UI.formatDate(atual.data_avaliacao))}</span>
                        </div>
                        ${rpgUI.renderRadarSvg(atual.pilares, anterior ? anterior.pilares : null, deltas)}
                        <div class="rpg-radar-legend">
                            <span class="rpg-legend-item"><span class="rpg-legend-swatch atual"></span>Atual (${Number(atual.score_total)} pts)</span>
                            ${anterior ? `<span class="rpg-legend-item"><span class="rpg-legend-swatch anterior"></span>${UI.escapeHtml(UI.formatDate(anterior.data_avaliacao))} (${Number(anterior.score_total)} pts)</span>` : ''}
                        </div>
                        ${rpgHistory.length > 1 ? `
                            <div class="rpg-compare-row">
                                <label for="rpg-compare-select" style="font-size: 11px; color: #94a3b8; font-weight: 600;">Comparar com:</label>
                                <select id="rpg-compare-select" class="select-filter" style="padding: 5px 8px; font-size: 11.5px;" onchange="AlunoDetalhesModule.onChangeRpgCompare(this.value)">
                                    <option value="">Sem sobreposição</option>
                                    ${compareOptions}
                                </select>
                            </div>
                        ` : ''}
                        <button type="button" class="btn btn-secondary btn-sm rpg-story-trigger-btn" onclick="AlunoDetalhesModule.openRpgStatusCard()">
                            <span>📸 Gerar Card de Status (Stories 9:16)</span>
                        </button>
                    </div>

                    <div class="rpg-stats-card">
                        <div class="rpg-summary-header">
                            ${rpgUI.renderRankBadgeHtml(atual.rank_combate, atual.rank_titulo, 'md')}
                            <div class="rpg-score-hero">
                                <strong>${Number(atual.score_total)}<span>/100</span></strong>
                                ${deltas ? rpgUI.renderDeltaBadgeHtml(deltas.score_total, ' pts') : ''}
                            </div>
                            ${rpgUI.renderSparringBadgeHtml(Boolean(atual.apto_sparring))}
                        </div>

                        <div style="margin-bottom: 12px;">
                            ${rpgUI.renderArchetypePillHtml(arquetipoObj)}
                        </div>

                        <div class="rpg-pillar-bars-list">
                            ${rpgUI.renderPillarBarsHtml(atual.pilares, deltas)}
                        </div>

                        ${atual.observacoes_instrutor ? `
                            <div class="rpg-instructor-note">
                                <strong style="color: #38bdf8; display: block; margin-bottom: 3px;">Feedback do Instrutor &amp; Metas Prajied:</strong>
                                ${UI.escapeHtml(atual.observacoes_instrutor)}
                            </div>
                        ` : ''}
                    </div>
                </div>

                ${rpgUI.renderBadgesGridHtml(badgesArr)}
                ${rpgUI.renderExamProgressionCardHtml(requisitosExame)}
            `;
        } else {
            heroHtml = `
                <div class="stat-card" style="padding: 22px; text-align: center; margin-bottom: 18px; border: 1px dashed rgba(56, 189, 248, 0.3);">
                    <div style="font-size: 28px; margin-bottom: 6px;">🥋</div>
                    <h4 style="margin: 0 0 6px 0; color: #ffffff; font-size: 15px;">Ficha Técnica RPG de Combate</h4>
                    <p style="margin: 0; font-size: 12.5px; color: var(--text-muted);">
                        Este aluno ainda não possui uma avaliação RPG (20 critérios / 5 atributos). Clique no botão abaixo para preencher em menos de 1 minuto.
                    </p>
                </div>
                ${rpgUI ? rpgUI.renderExamProgressionCardHtml(requisitosExame) : ''}
            `;
        }

        const renderExpandedBlock = (d) => {
            if (Number(this.rpgExpandedEvalId) !== Number(d.id)) return '';
            if (!rpgUI || !(d.is_rpg || d.modelo_avaliacao === 'rpg')) return '';
            return `
                <div style="margin-top: 8px;">
                    ${rpgUI.renderCriteriaBreakdownHtml(d.criterios, Boolean(d.apto_sparring))}
                </div>
            `;
        };

        desTabEl.innerHTML = `
            ${heroHtml}

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
                <div>
                    <h4 style="font-family: var(--font-heading); margin: 0; font-size: 16px; color: #ffffff;">Histórico de Avaliações Técnicas RPG</h4>
                    <p style="font-size: 12px; color: var(--text-muted); margin: 2px 0 0 0;">20 critérios técnicos consolidados em Inteligência, Destreza, Agilidade, Força e Vitalidade.</p>
                </div>
                <button type="button" class="btn btn-primary btn-sm" style="min-height: 40px;" onclick="AlunoDetalhesModule.openModalDesempenho(${safeAlunoId}, '${encodedAlunoNome}')">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                    <span>Nova Avaliação RPG</span>
                </button>
            </div>

            <div class="table-card">
                ${desList.length === 0 ? `
                    <div style="text-align: center; padding: 32px; color: var(--text-muted);">
                        Nenhuma avaliação registrada ainda para este atleta.
                    </div>
                ` : `
                    <div class="table-responsive dossier-desktop-table">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Data</th>
                                    <th>Rank / Score</th>
                                    <th>Sparring</th>
                                    <th>5 Pilares RPG (0-20)</th>
                                    <th>Instrutor</th>
                                    <th style="text-align: right;">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${desList.map((d) => {
                                    const isRpg = d.is_rpg || d.modelo_avaliacao === 'rpg';
                                    const isExpanded = Number(this.rpgExpandedEvalId) === Number(d.id);
                                    if (!isRpg) {
                                        return `
                                            <tr>
                                                <td style="font-weight: 700;">${UI.formatDate(d.data_avaliacao)}</td>
                                                <td><span class="status-badge status-pending">Modelo Anterior</span></td>
                                                <td>—</td>
                                                <td style="font-size: 11.5px; color: #94a3b8;">
                                                    Clinch ${Number(d.nota_clinch ?? d.nota_clinch_sparring ?? 0).toFixed(1)} • Socos ${Number(d.nota_socos || 0).toFixed(1)} • Chutes ${Number(d.nota_chutes || 0).toFixed(1)} • Postura ${Number(d.nota_postura || 0).toFixed(1)}
                                                </td>
                                                <td><span style="font-size: 12px; color: #cbd5e1;">${UI.escapeHtml(d.professor_nome || 'Professor')}</span></td>
                                                <td style="text-align: right;">
                                                    <button type="button" class="btn btn-secondary btn-sm" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3); padding: 4px 10px; font-size: 11px;"
                                                        onclick="AlunoDetalhesModule.deleteAvaliacaoDesempenho(${Number(d.id)})">
                                                        Excluir
                                                    </button>
                                                </td>
                                            </tr>
                                        `;
                                    }
                                    const p = d.pilares || {};
                                    return `
                                        <tr>
                                            <td style="font-weight: 700; white-space: nowrap;">${UI.formatDate(d.data_avaliacao)}</td>
                                            <td>
                                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                                    ${rpgUI ? rpgUI.renderRankBadgeHtml(d.rank_combate, d.rank_titulo, 'sm') : `<strong>Rank ${UI.escapeHtml(d.rank_combate)}</strong>`}
                                                    <strong style="color: #ffffff; font-size: 13px;">${Number(d.score_total)}/100</strong>
                                                </div>
                                            </td>
                                            <td>${rpgUI ? rpgUI.renderSparringBadgeHtml(Boolean(d.apto_sparring)) : (d.apto_sparring ? 'Sim' : 'Não')}</td>
                                            <td style="font-size: 11.5px; color: #cbd5e1; white-space: nowrap;">
                                                <span style="color:#38bdf8;font-weight:700;">INT ${Number(p.inteligencia ?? d.score_inteligencia ?? 0)}</span> •
                                                <span style="color:#a855f7;font-weight:700;">DES ${Number(p.destreza ?? d.score_destreza ?? 0)}</span> •
                                                <span style="color:#22c55e;font-weight:700;">AGI ${Number(p.agilidade ?? d.score_agilidade ?? 0)}</span> •
                                                <span style="color:#f97316;font-weight:700;">FOR ${Number(p.forca ?? d.score_forca ?? 0)}</span> •
                                                <span style="color:#ef4444;font-weight:700;">VIT ${Number(p.vitalidade ?? d.score_vitalidade ?? 0)}</span>
                                            </td>
                                            <td><span style="font-size: 12px; color: #cbd5e1;">${UI.escapeHtml(d.professor_nome || 'Instrutor')}</span></td>
                                            <td style="text-align: right; white-space: nowrap;">
                                                <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 9px; font-size: 11px; margin-right: 4px;"
                                                    onclick="AlunoDetalhesModule.toggleRpgEvalDetails(${Number(d.id)})">
                                                    ${isExpanded ? 'Ocultar 20 itens' : 'Ver 20 itens'}
                                                </button>
                                                <button type="button" class="btn btn-secondary btn-sm" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3); padding: 4px 9px; font-size: 11px;"
                                                    onclick="AlunoDetalhesModule.deleteAvaliacaoDesempenho(${Number(d.id)})">
                                                    Excluir
                                                </button>
                                            </td>
                                        </tr>
                                        ${isExpanded ? `
                                            <tr>
                                                <td colspan="6" style="background: rgba(15, 23, 42, 0.55); padding: 14px;">
                                                    ${d.observacoes_instrutor ? `<div style="font-size: 12px; color: #cbd5e1; margin-bottom: 10px;"><strong>Obs:</strong> ${UI.escapeHtml(d.observacoes_instrutor)}</div>` : ''}
                                                    ${renderExpandedBlock(d)}
                                                </td>
                                            </tr>
                                        ` : ''}
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="dossier-mobile-list">
                        ${desList.map((d) => {
                            const isRpg = d.is_rpg || d.modelo_avaliacao === 'rpg';
                            const isExpanded = Number(this.rpgExpandedEvalId) === Number(d.id);
                            if (!isRpg) {
                                return `
                                    <div class="dossier-mobile-card">
                                        <div style="display:flex;justify-content:space-between;align-items:center;">
                                            <strong style="color:#fff;">${UI.formatDate(d.data_avaliacao)}</strong>
                                            <span style="font-size:11px;color:#94a3b8;">Modelo Anterior</span>
                                        </div>
                                        <button type="button" class="btn btn-secondary btn-sm" style="width:100%;color:#ef4444;border-color:rgba(239,68,68,0.3);"
                                            onclick="AlunoDetalhesModule.deleteAvaliacaoDesempenho(${Number(d.id)})">Excluir Avaliação</button>
                                    </div>
                                `;
                            }
                            const p = d.pilares || {};
                            return `
                                <div class="dossier-mobile-card">
                                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                                        <strong style="color:#ffffff;font-size:13.5px;">${UI.formatDate(d.data_avaliacao)}</strong>
                                        <strong style="color:#38bdf8;font-size:14px;">${Number(d.score_total)}/100</strong>
                                    </div>
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                                        ${rpgUI ? rpgUI.renderRankBadgeHtml(d.rank_combate, d.rank_titulo, 'sm') : ''}
                                        ${rpgUI ? rpgUI.renderSparringBadgeHtml(Boolean(d.apto_sparring)) : ''}
                                    </div>
                                    <div style="font-size:11.5px;color:#cbd5e1;display:flex;flex-wrap:wrap;gap:6px;">
                                        <span>INT ${Number(p.inteligencia ?? 0)}</span> •
                                        <span>DES ${Number(p.destreza ?? 0)}</span> •
                                        <span>AGI ${Number(p.agilidade ?? 0)}</span> •
                                        <span>FOR ${Number(p.forca ?? 0)}</span> •
                                        <span>VIT ${Number(p.vitalidade ?? 0)}</span>
                                    </div>
                                    ${d.observacoes_instrutor ? `<div style="font-size:12px;color:#94a3b8;">${UI.escapeHtml(d.observacoes_instrutor)}</div>` : ''}
                                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                                        <button type="button" class="btn btn-secondary btn-sm" style="min-height:38px;justify-content:center;"
                                            onclick="AlunoDetalhesModule.toggleRpgEvalDetails(${Number(d.id)})">
                                            ${isExpanded ? 'Ocultar 20 itens' : 'Ver 20 itens'}
                                        </button>
                                        <button type="button" class="btn btn-secondary btn-sm" style="min-height:38px;justify-content:center;color:#ef4444;border-color:rgba(239,68,68,0.3);"
                                            onclick="AlunoDetalhesModule.deleteAvaliacaoDesempenho(${Number(d.id)})">
                                            Excluir
                                        </button>
                                    </div>
                                    ${renderExpandedBlock(d)}
                                </div>
                            `;
                        }).join('')}
                    </div>
                `}
            </div>
        `;
    },

    // ==========================================
    // OPERAÇÕES CONTRATUAIS
    // ==========================================

    // 1. Trancar Matrícula
    openModalTrancarMatricula(matriculaId) {
        document.getElementById('trancar-matricula-id').value = matriculaId;
        document.getElementById('trancar-motivo-select').value = '';
        document.getElementById('trancar-motivo-custom').value = '';
        document.getElementById('trancar-motivo-custom-group').style.display = 'none';
        document.getElementById('trancar-data-retorno').value = '';
        document.getElementById('trancar-cancelar-faturas').checked = true;
        UI.openModal('modal-trancar-matricula');
    },

    async submitTrancarMatricula(e) {
        e.preventDefault();
        const matriculaId = document.getElementById('trancar-matricula-id').value;
        const selectMotivo = document.getElementById('trancar-motivo-select').value;
        const customMotivo = document.getElementById('trancar-motivo-custom').value.trim();
        const dataRetorno = document.getElementById('trancar-data-retorno').value;
        const cancelarFaturas = document.getElementById('trancar-cancelar-faturas').checked;

        const motivoFinal = selectMotivo === 'Outro' && customMotivo ? customMotivo : selectMotivo;
        if (!motivoFinal) {
            UI.showToast('Selecione ou informe o motivo do trancamento.', 'warning');
            return;
        }

        const btn = document.getElementById('btn-submit-trancar');
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner"></div> Processando...`;

        try {
            const res = await API.post(`/planos/matriculas/${matriculaId}/trancar`, {
                motivo: motivoFinal,
                data_retorno_prevista: dataRetorno || null,
                cancelar_faturas_abertas: cancelarFaturas
            });

            UI.showToast(res.message, 'success');
            UI.closeModal('modal-trancar-matricula');
            await this.openDossier(this.currentAlunoId);
            if (window.AlunosModule) AlunosModule.loadAlunos();
            if (window.PlanosModule) PlanosModule.loadAll();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao trancar matrícula.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Confirmar Trancamento';
        }
    },

    // 2. Destrancar Matrícula
    openModalDestrancar(matriculaId) {
        document.getElementById('destrancar-matricula-id').value = matriculaId;
        UI.openModal('modal-destrancar-matricula');
    },

    async submitDestrancarMatricula(e) {
        e.preventDefault();
        const matriculaId = document.getElementById('destrancar-matricula-id').value;
        const btn = document.getElementById('btn-submit-destrancar');
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner"></div> Reativando...`;

        try {
            const res = await API.post(`/planos/matriculas/${matriculaId}/destrancar`, {});
            UI.showToast(res.message, 'success');
            UI.closeModal('modal-destrancar-matricula');
            await this.openDossier(this.currentAlunoId);
            if (window.AlunosModule) AlunosModule.loadAlunos();
            if (window.PlanosModule) PlanosModule.loadAll();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao destrancar matrícula.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Confirmar Reativação';
        }
    },

    // 3. Trocar Plano (Upgrade / Downgrade)
    openModalTrocarPlano(matriculaId, planoAtualId, planoAtualNome, valorAtual) {
        document.getElementById('troca-matricula-id').value = matriculaId;
        document.getElementById('troca-plano-atual-nome').textContent = planoAtualNome;
        document.getElementById('troca-plano-atual-valor').textContent = `${UI.formatCurrency(valorAtual)} / mês`;
        document.getElementById('troca-plano-atual-valor').dataset.valor = valorAtual;

        const selectNovo = document.getElementById('troca-novo-plano-id');
        selectNovo.innerHTML = '<option value="">Selecione o novo plano...</option>' + 
            this.planosCache
                .filter(p => p.id != planoAtualId && p.ativo == 1)
                .map(p => `<option value="${Number(p.id)}" data-valor="${Number(p.valor_mensal) || 0}">${UI.escapeHtml(p.nome)} - ${UI.formatCurrency(p.valor_mensal)}/mês</option>`)
                .join('');

        document.getElementById('troca-novo-valor').value = '';
        document.getElementById('troca-novo-vencimento').value = this.currentMatricula ? this.currentMatricula.dia_vencimento : '10';
        document.getElementById('troca-motivo').value = '';
        document.getElementById('troca-badge-tipo').style.display = 'none';

        UI.openModal('modal-trocar-plano');
    },

    updateTrocaPlanoPreview(novoPlanoId) {
        const badge = document.getElementById('troca-badge-tipo');
        const inputValor = document.getElementById('troca-novo-valor');
        if (!novoPlanoId) {
            badge.style.display = 'none';
            inputValor.value = '';
            return;
        }

        const planoNovo = this.planosCache.find(p => p.id == novoPlanoId);
        if (!planoNovo) return;

        inputValor.value = parseFloat(planoNovo.valor_mensal).toFixed(2);

        const valorAtual = parseFloat(document.getElementById('troca-plano-atual-valor').dataset.valor || 0);
        const isUpgrade = parseFloat(planoNovo.valor_mensal) > valorAtual;

        badge.style.display = 'inline-block';
        if (isUpgrade) {
            badge.textContent = '🚀 UPGRADE';
            badge.style.background = 'rgba(16, 185, 129, 0.2)';
            badge.style.color = '#10b981';
            badge.style.border = '1px solid rgba(16, 185, 129, 0.4)';
        } else {
            badge.textContent = '🔻 DOWNGRADE';
            badge.style.background = 'rgba(56, 189, 248, 0.2)';
            badge.style.color = '#38bdf8';
            badge.style.border = '1px solid rgba(56, 189, 248, 0.4)';
        }
    },

    async submitTrocarPlano(e) {
        e.preventDefault();
        const matriculaId = document.getElementById('troca-matricula-id').value;
        const novo_plano_id = document.getElementById('troca-novo-plano-id').value;
        const novo_valor_acordado = parseFloat(document.getElementById('troca-novo-valor').value);
        const novo_dia_vencimento = document.getElementById('troca-novo-vencimento').value;
        const motivo = document.getElementById('troca-motivo').value.trim();

        if (!novo_plano_id || isNaN(novo_valor_acordado) || novo_valor_acordado <= 0) {
            UI.showToast('Selecione o novo plano e informe um valor mensal válido.', 'warning');
            return;
        }

        const btn = document.getElementById('btn-submit-troca-plano');
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner"></div> Processando migração...`;

        try {
            const res = await API.post(`/planos/matriculas/${matriculaId}/trocar-plano`, {
                novo_plano_id,
                novo_valor_acordado,
                novo_dia_vencimento,
                motivo
            });

            UI.showToast(res.message, 'success');
            UI.closeModal('modal-trocar-plano');
            await this.openDossier(this.currentAlunoId);
            if (window.AlunosModule) AlunosModule.loadAlunos();
            if (window.PlanosModule) PlanosModule.loadAll();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao trocar plano.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Confirmar Migração';
        }
    },

    // 4. Cancelar Matrícula
    openModalCancelarMatricula(matriculaId) {
        document.getElementById('cancelar-matricula-id').value = matriculaId;
        document.getElementById('cancelar-motivo-select').value = '';
        document.getElementById('cancelar-motivo-obs').value = '';
        document.getElementById('cancelar-faturas-pendentes').checked = true;
        UI.openModal('modal-cancelar-matricula');
    },

    async submitCancelarMatricula(e) {
        e.preventDefault();
        const matriculaId = document.getElementById('cancelar-matricula-id').value;
        const motivoSelect = document.getElementById('cancelar-motivo-select').value;
        const obs = document.getElementById('cancelar-motivo-obs').value.trim();
        const cancelarFaturas = document.getElementById('cancelar-faturas-pendentes').checked;

        if (!motivoSelect) {
            UI.showToast('Selecione a justificativa do cancelamento.', 'warning');
            return;
        }

        const motivoFinal = obs ? `${motivoSelect} (${obs})` : motivoSelect;

        const btn = document.getElementById('btn-submit-cancelar');
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner"></div> Cancelando...`;

        try {
            const res = await API.post(`/planos/matriculas/${matriculaId}/cancelar`, {
                motivo: motivoFinal,
                cancelar_faturas_abertas: cancelarFaturas
            });

            UI.showToast(res.message, 'success');
            UI.closeModal('modal-cancelar-matricula');
            await this.openDossier(this.currentAlunoId);
            if (window.AlunosModule) AlunosModule.loadAlunos();
            if (window.PlanosModule) PlanosModule.loadAll();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao cancelar contrato.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Confirmar Cancelamento';
        }
    },

    // 5. Nova Matrícula para Aluno no Dossiê
    openModalNovaMatricula(alunoId) {
        document.getElementById('nova-mat-aluno-id').value = alunoId;
        const select = document.getElementById('nova-mat-plano-id');
        select.innerHTML = '<option value="">Selecione um plano comercial...</option>' + 
            this.planosCache.filter(p => p.ativo == 1).map(p => `
                <option value="${Number(p.id)}">${UI.escapeHtml(p.nome)} - ${UI.formatCurrency(p.valor_mensal)}/mês</option>
            `).join('');

        document.getElementById('nova-mat-valor').value = '';
        document.getElementById('nova-mat-vencimento').value = '10';
        document.getElementById('nova-mat-desconto').value = '';
        UI.openModal('modal-nova-matricula-aluno');
    },

    async submitNovaMatricula(e) {
        e.preventDefault();
        const aluno_id = document.getElementById('nova-mat-aluno-id').value;
        const plano_id = document.getElementById('nova-mat-plano-id').value;
        const valor_acordado = parseFloat(document.getElementById('nova-mat-valor').value);
        const dia_vencimento = document.getElementById('nova-mat-vencimento').value;
        const desconto_motivo = document.getElementById('nova-mat-desconto').value.trim();

        if (!plano_id || isNaN(valor_acordado) || valor_acordado <= 0) {
            UI.showToast('Selecione o plano e confirme o valor mensal.', 'warning');
            return;
        }

        const btn = document.getElementById('btn-submit-nova-mat');
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner"></div> Processando matrícula...`;

        try {
            const res = await API.post('/planos/matriculas', {
                aluno_id,
                plano_id,
                valor_acordado,
                dia_vencimento,
                desconto_motivo
            });

            UI.showToast(res.message, 'success');
            UI.closeModal('modal-nova-matricula-aluno');
            await this.openDossier(this.currentAlunoId);
            if (window.AlunosModule) AlunosModule.loadAlunos();
            if (window.PlanosModule) PlanosModule.loadAll();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao efetivar matrícula.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Efetivar Matrícula';
        }
    },

    // 6. Baixa de Fatura no Dossiê
    async darBaixaFatura(faturaId) {
        if (!this.currentData || !this.currentData.faturas) return;
        const fat = this.currentData.faturas.find(f => f.id == faturaId);
        if (fat && window.PlanosModule) {
            PlanosModule.openModalBaixa(
                Number(fat.id),
                Number(fat.valor_original) || 0,
                this.currentData.aluno.nome_completo || 'Aluno',
                fat.competencia || ''
            );
            return;
        }

        if (!confirm('Deseja confirmar o pagamento manual desta mensalidade?')) return;
        try {
            await API.patch(`/faturas/${faturaId}/pagar`, { metodo_pagamento: 'dinheiro' });
            UI.showToast('Mensalidade baixada com sucesso!', 'success');
            if (this.currentAlunoId) {
                await this.openDossier(this.currentAlunoId);
            }
            if (window.PlanosModule) PlanosModule.loadFaturas();
        } catch (err) {
            UI.showToast('Erro ao baixar fatura: ' + err.message, 'error');
        }
    },

    // 7. Modal e Lançamento de Avaliações Técnicas de Graduação
    openModalAvaliacao(alunoId, modalidadeId, graduacaoNivelId) {
        if (!this.currentData || !this.currentData.avaliacoes) return;
        const av = this.currentData.avaliacoes.find(a => a.modalidade_id == modalidadeId && a.graduacao_nivel_id == graduacaoNivelId);
        if (!av) {
            UI.showToast('Graduação não localizada no dossiê do aluno.', 'error');
            return;
        }

        this.currentAvaliacao = JSON.parse(JSON.stringify(av));

        document.getElementById('avaliacao-aluno-id').value = alunoId;
        document.getElementById('avaliacao-modalidade-id').value = modalidadeId;
        document.getElementById('avaliacao-graduacao-nivel-id').value = graduacaoNivelId;

        document.getElementById('avaliacao-modal-subtitle').textContent = 
            `${this.currentData.aluno.nome_completo} • ${av.modalidade_nome}`;

        document.getElementById('avaliacao-belt-preview').innerHTML = 
            UI.renderBeltBadge(av.nivel_nome, av.cor_hex_primaria, av.cor_hex_secundaria);

        document.getElementById('avaliacao-faixa-nome').textContent = av.nivel_nome;
        document.getElementById('avaliacao-exigencia-minima').innerHTML = 
            `Exigência mínima: <strong style="color: #38bdf8;">${Number(av.porcentagem_minima || 70)}%</strong>`;

        document.getElementById('avaliacao-observacoes').value = av.observacoes_professor || '';

        this.renderAvaliacaoItens();
        this.recalculateLiveScore();

        UI.openModal('modal-avaliacao-graduacao');
    },

    renderAvaliacaoItens() {
        const container = document.getElementById('avaliacao-itens-container');
        if (!container || !this.currentAvaliacao) return;

        const itens = this.currentAvaliacao.itens_avaliados || [];
        if (itens.length === 0) {
            container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">Nenhum requisito cadastrado nesta faixa. Configure em "Graduações & Faixas".</div>`;
            return;
        }

        container.innerHTML = itens.map((item, idx) => {
            const currentNota = Number(item.nota) || 0;
            return `
                <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                    <div style="flex: 1; min-width: 200px;">
                        <span style="font-weight: 600; font-size: 13px; color: var(--text-main); display: block;">
                            ${idx + 1}. ${UI.escapeHtml(item.item)}
                        </span>
                    </div>

                    <!-- 5 Notas Aplicáveis (1 a 5) -->
                    <div style="display: flex; align-items: center; gap: 6px;">
                        ${[1, 2, 3, 4, 5].map(nota => {
                            const isSelected = currentNota === nota;
                            return `
                                <button type="button" 
                                    class="btn ${isSelected ? 'btn-primary' : 'btn-secondary'}"
                                    style="width: 38px; height: 36px; padding: 0; font-size: 13px; font-weight: 700; ${isSelected ? 'box-shadow: 0 0 10px rgba(56, 189, 248, 0.5); border-color: #38bdf8;' : ''}"
                                    onclick="AlunoDetalhesModule.setNotaItem(${idx}, ${nota})">
                                    ${nota}
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }).join('');
    },

    setNotaItem(idx, nota) {
        if (!this.currentAvaliacao || !this.currentAvaliacao.itens_avaliados[idx]) return;
        this.currentAvaliacao.itens_avaliados[idx].nota = nota;
        this.renderAvaliacaoItens();
        this.recalculateLiveScore();
    },

    recalculateLiveScore() {
        if (!this.currentAvaliacao) return;
        const itens = this.currentAvaliacao.itens_avaliados || [];
        const totalPossivel = itens.length * 5;
        let totalObtido = 0;
        itens.forEach(i => { totalObtido += (Number(i.nota) || 0); });

        const pct = totalPossivel > 0 ? parseFloat(((totalObtido / totalPossivel) * 100).toFixed(2)) : 0;
        const minPct = Number(this.currentAvaliacao.porcentagem_minima) || 70.00;
        const isApto = pct >= minPct;

        const livePctEl = document.getElementById('avaliacao-live-pct');
        const livePtsEl = document.getElementById('avaliacao-live-pts');
        const statusBadgeEl = document.getElementById('avaliacao-live-status-badge');
        const promoBox = document.getElementById('avaliacao-promocao-box');
        const proxFaixaTexto = document.getElementById('avaliacao-proxima-faixa-texto');

        if (livePctEl) livePctEl.textContent = `${pct}%`;
        if (livePtsEl) livePtsEl.textContent = `(${totalObtido} / ${totalPossivel} pts)`;

        if (statusBadgeEl) {
            statusBadgeEl.innerHTML = isApto
                ? `<span class="badge-status ativo" style="font-size: 11px; font-weight: 700;">✅ Apto para Próxima Fase</span>`
                : `<span class="badge-status pendente" style="font-size: 11px;">⏳ Abaixo do Mínimo (${minPct}%)</span>`;
        }

        if (promoBox) {
            if (isApto) {
                promoBox.style.display = 'block';
                if (proxFaixaTexto) {
                    if (this.currentAvaliacao.proxima_graduacao) {
                        proxFaixaTexto.innerHTML = `Próxima graduação: <strong style="color: #ffffff;">${UI.escapeHtml(this.currentAvaliacao.proxima_graduacao.nome)}</strong>`;
                    } else {
                        proxFaixaTexto.innerHTML = `<span style="color: #10b981;">Nível máximo desta modalidade atingido!</span>`;
                    }
                }
            } else {
                promoBox.style.display = 'none';
            }
        }
    },

    async submitAvaliacao(e) {
        e.preventDefault();
        if (!this.currentAvaliacao) return;

        const alunoId = document.getElementById('avaliacao-aluno-id').value;
        const modalidadeId = document.getElementById('avaliacao-modalidade-id').value;
        const graduacaoNivelId = document.getElementById('avaliacao-graduacao-nivel-id').value;
        const observacoes = document.getElementById('avaliacao-observacoes').value;

        const btn = document.getElementById('btn-salvar-avaliacao');
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner"></div> Salvando...`;

        try {
            const res = await API.post(`/alunos/${alunoId}/avaliacoes-graduacao`, {
                modalidade_id: modalidadeId,
                graduacao_nivel_id: graduacaoNivelId,
                itens_avaliados: this.currentAvaliacao.itens_avaliados,
                observacoes
            });

            UI.showToast(res.message, 'success');
            await this.openDossier(alunoId);
            this.switchTab('graduacoes');
            UI.closeModal('modal-avaliacao-graduacao');
            if (window.AlunosModule) AlunosModule.loadAlunos();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao salvar avaliação.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '💾 Salvar Avaliação';
        }
    },

    async aprovarPromocao() {
        if (!this.currentAvaliacao) return;
        const alunoId = document.getElementById('avaliacao-aluno-id').value;
        const modalidadeId = document.getElementById('avaliacao-modalidade-id').value;
        const graduacaoNivelId = document.getElementById('avaliacao-graduacao-nivel-id').value;
        const observacoes = document.getElementById('avaliacao-observacoes').value;

        const proxNome = this.currentAvaliacao.proxima_graduacao 
            ? this.currentAvaliacao.proxima_graduacao.nome 
            : 'próxima faixa';

        if (!confirm(`Deseja confirmar a promoção oficial deste aluno para "${proxNome}"?`)) return;

        const btn = document.getElementById('btn-aprovar-promocao');
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner"></div> Promovendo...`;

        try {
            const res = await API.post(`/alunos/${alunoId}/aprovar-promocao`, {
                modalidade_id: modalidadeId,
                graduacao_nivel_id: graduacaoNivelId,
                observacoes
            });

            UI.showToast(res.message, 'success');
            UI.closeModal('modal-avaliacao-graduacao');
            await this.openDossier(alunoId);
            this.switchTab('graduacoes');
            if (window.AlunosModule) AlunosModule.loadAlunos();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao aprovar promoção.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🎓 Aprovar Graduação & Promover';
            }
        }
    },

    async retrocederGraduacao(alunoId, modalidadeId, graduacaoId = null) {
        const av = this.currentData?.avaliacoes?.find(
            a => Number(a.modalidade_id) === Number(modalidadeId) && (!graduacaoId || Number(a.aluno_graduacao_id) === Number(graduacaoId))
        );
        const grad = this.currentData?.graduacoes?.find(
            g => Number(g.modalidade_id) === Number(modalidadeId) && Number(g.atual) === 1
        );

        const faixaAtualNome = av?.nivel_nome || grad?.nivel_nome || 'faixa atual';
        const faixaDestinoNome = av?.graduacao_anterior_retrocesso?.nome
            || grad?.graduacao_anterior_retrocesso?.nome
            || 'faixa anterior';

        if (!confirm(`Deseja retroceder a graduação de "${faixaAtualNome}" de volta para "${faixaDestinoNome}"? A avaliação salva anteriormente será preservada.`)) {
            return;
        }

        try {
            const payload = { modalidade_id: Number(modalidadeId) };
            if (graduacaoId && Number(graduacaoId) > 0) {
                payload.graduacao_id = Number(graduacaoId);
            }

            const res = await API.post(`/alunos/${Number(alunoId)}/retroceder-graduacao`, payload);
            UI.showToast(res.message || 'Graduação retrocedida com sucesso!', 'success');
            await this.openDossier(alunoId);
            this.switchTab('graduacoes');
            if (window.AlunosModule) AlunosModule.loadAlunos();
        } catch (err) {
            UI.showToast(err.message || 'Erro ao retroceder graduação.', 'error');
        }
    },

    // 8. Modal e Registro da Avaliação Técnica Gamificada (RPG Muay Thai)
    openModalDesempenho(alunoId, alunoNome) {
        const rpgUI = window.RpgAvaliacaoUI;
        const maxScale = rpgUI?.CRITERIA_MAX || 10;
        document.getElementById('desempenho-aluno-id').value = alunoId;
        const sub = document.getElementById('desempenho-modal-sub');
        if (sub && alunoNome) {
            sub.textContent = `Atleta: ${decodeURIComponent(alunoNome)} • 20 critérios (0 a ${maxScale})`;
        }
        const dataInput = document.getElementById('desempenho-data');
        if (dataInput) {
            dataInput.value = new Date().toISOString().split('T')[0];
        }

        const criteriosIniciais = {};
        if (rpgUI) {
            rpgUI.CRITERIA.forEach(c => { criteriosIniciais[c.id] = 0; });
        }
        this.rpgFormState = {
            apto_sparring: null,
            criterios: criteriosIniciais
        };

        const obsInput = document.getElementById('desempenho-obs');
        if (obsInput) obsInput.value = '';

        const btnCarregarUltima = document.getElementById('btn-rpg-carregar-ultima');
        const hasPriorRpg = Boolean(this.currentData?.avaliacao_rpg?.historico?.length > 0);
        if (btnCarregarUltima) {
            btnCarregarUltima.style.display = hasPriorRpg ? 'inline-flex' : 'none';
        }

        this.syncRpgSparringButtonsUi();
        this.renderRpgFormCriteria();
        this.updateRpgLiveScoreboard();

        UI.openModal('modal-avaliacao-desempenho');
    },

    carregarUltimaRpgNoFormulario() {
        const ultima = this.currentData?.avaliacao_rpg?.atual;
        const rpgUI = window.RpgAvaliacaoUI;
        if (!ultima || !rpgUI) return;
        const maxScale = rpgUI.CRITERIA_MAX || 10;

        const baseCriterios = {};
        rpgUI.CRITERIA.forEach((c) => {
            const val = ultima.criterios && ultima.criterios[c.id] !== undefined ? Number(ultima.criterios[c.id]) : 0;
            baseCriterios[c.id] = Math.max(0, Math.min(maxScale, isNaN(val) ? 0 : val));
        });

        this.rpgFormState.criterios = baseCriterios;
        this.setRpgAptoSparring(Boolean(ultima.apto_sparring));
        UI.showToast('Última avaliação RPG carregada como base!', 'info');
    },

    syncRpgSparringButtonsUi() {
        const btnSim = document.getElementById('btn-sparring-sim');
        const btnNao = document.getElementById('btn-sparring-nao');
        const lockAlert = document.getElementById('rpg-sparring-lock-alert');
        const st = this.rpgFormState.apto_sparring;

        if (btnSim) btnSim.classList.toggle('active-sim', st === true);
        if (btnNao) btnNao.classList.toggle('active-nao', st === false);
        if (lockAlert) lockAlert.style.display = st === false ? 'flex' : 'none';
    },

    setRpgAptoSparring(isApto) {
        this.rpgFormState.apto_sparring = Boolean(isApto);
        const rpgUI = window.RpgAvaliacaoUI;
        const sparringCap = rpgUI?.SPARRING_CAP || 6;

        if (!this.rpgFormState.apto_sparring && rpgUI) {
            let ajustados = false;
            rpgUI.CRITERIA.forEach((c) => {
                if (c.isSparring && Number(this.rpgFormState.criterios[c.id] || 0) > sparringCap) {
                    this.rpgFormState.criterios[c.id] = sparringCap;
                    ajustados = true;
                }
            });
            if (ajustados) {
                UI.showToast(`Critérios [SPARRING] limitados a ${sparringCap} pontos para simulado controlado.`, 'warning');
            }
        }

        this.syncRpgSparringButtonsUi();
        this.renderRpgFormCriteria();
        this.updateRpgLiveScoreboard();
    },

    setRpgCriterionScore(criterionId, val) {
        const rpgUI = window.RpgAvaliacaoUI;
        if (!rpgUI) return;
        const criterion = rpgUI.CRITERIA.find(c => c.id === criterionId);
        if (!criterion) return;

        const maxScale = rpgUI.CRITERIA_MAX || 10;
        const sparringCap = rpgUI.SPARRING_CAP || 6;
        let safeVal = Math.max(0, Math.min(maxScale, Math.round(Number(val) || 0)));
        if (this.rpgFormState.apto_sparring === false && criterion.isSparring && safeVal > sparringCap) {
            safeVal = sparringCap;
            UI.showToast(`Trava ativa: aluno não apto ao sparring possui teto máximo de ${sparringCap} neste critério.`, 'warning');
        }

        this.rpgFormState.criterios[criterionId] = safeVal;
        this.renderRpgFormCriteria();
        this.updateRpgLiveScoreboard();
    },

    renderRpgFormCriteria() {
        const container = document.getElementById('rpg-criterios-container');
        const rpgUI = window.RpgAvaliacaoUI;
        if (!container || !rpgUI) return;

        const maxScale = rpgUI.CRITERIA_MAX || 10;
        const sparringCap = rpgUI.SPARRING_CAP || 6;
        const scaleValues = Array.from({ length: maxScale + 1 }, (_, i) => i);
        const isSparLocked = this.rpgFormState.apto_sparring === false;
        const totals = rpgUI.calculateTotals(this.rpgFormState.criterios, this.rpgFormState.apto_sparring !== false);

        container.innerHTML = rpgUI.PILLARS.map((pillar) => {
            const criteriaList = rpgUI.CRITERIA.filter(c => c.pilar === pillar.id);
            const subTotal = totals.pilares[pillar.id] || 0;

            return `
                <div class="rpg-pillar-card" style="border-left: 3px solid ${pillar.cor};">
                    <div class="rpg-pillar-card-header">
                        <div>
                            <h5>${UI.escapeHtml(pillar.nome)}</h5>
                            <p>${UI.escapeHtml(pillar.subtitulo)}</p>
                        </div>
                        <span class="rpg-pillar-subtotal" style="color: ${pillar.cor};">${subTotal} / 20 pts</span>
                    </div>
                    ${criteriaList.map((c) => {
                        const curVal = Number(this.rpgFormState.criterios[c.id] || 0);
                        const landmarksHtml = c.landmarks
                            ? `<div class="rpg-landmarks-row">${Object.values(c.landmarks).map(txt => `<span class="rpg-landmark-chip">${UI.escapeHtml(txt)}</span>`).join('')}</div>`
                            : '';

                        return `
                            <div class="rpg-criterion-row">
                                <div class="rpg-criterion-top">
                                    <div class="rpg-criterion-head-line">
                                        <span class="rpg-criterion-name">
                                            <span>${c.numero}. ${UI.escapeHtml(c.nome)}</span>
                                            ${c.isSparring ? `<span class="rpg-sparring-tag" title="Limitado ao máximo de ${sparringCap} pontos quando Apto para Sparring = Não">SPARRING</span>` : ''}
                                        </span>
                                        <span class="rpg-criterion-val-badge">${curVal}/${maxScale}</span>
                                    </div>
                                    <div class="rpg-seg-group" role="group" aria-label="${UI.escapeHtml(c.nome)}">
                                        ${scaleValues.map((n) => {
                                            const blocked = isSparLocked && c.isSparring && n > sparringCap;
                                            return `
                                                <button type="button"
                                                    class="rpg-seg-btn ${curVal === n ? 'active' : ''}"
                                                    data-criterion-id="${UI.escapeHtml(c.id)}"
                                                    data-val="${n}"
                                                    ${blocked ? `disabled title="Bloqueado (máx. ${sparringCap} para simulado controlado)"` : ''}>
                                                    ${n}
                                                </button>
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                                <div class="rpg-criterion-legend">
                                    <span>0: ${UI.escapeHtml(c.minLabel)}</span>
                                    <span style="text-align: right;">${maxScale}: ${UI.escapeHtml(c.maxLabel)}</span>
                                </div>
                                ${landmarksHtml}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }).join('');
    },

    updateRpgLiveScoreboard() {
        const rpgUI = window.RpgAvaliacaoUI;
        if (!rpgUI) return;

        const isSparAllowed = this.rpgFormState.apto_sparring !== false;
        const calc = rpgUI.calculateTotals(this.rpgFormState.criterios, isSparAllowed);

        const rankWrap = document.getElementById('rpg-live-rank-wrap');
        const totalEl = document.getElementById('rpg-live-score-total');
        const sparPill = document.getElementById('rpg-live-sparring-pill');
        const stripEl = document.getElementById('rpg-live-pillars-strip');

        if (rankWrap) rankWrap.innerHTML = rpgUI.renderRankBadgeHtml(calc.rank.codigo, calc.rank.titulo, 'sm');
        if (totalEl) totalEl.innerHTML = `${calc.total}<span>/100</span>`;
        if (sparPill) {
            if (this.rpgFormState.apto_sparring === null) {
                sparPill.innerHTML = `<span class="rpg-sparring-pill restrito" style="opacity:0.85;">Defina Sparring</span>`;
            } else {
                sparPill.innerHTML = rpgUI.renderSparringBadgeHtml(this.rpgFormState.apto_sparring);
            }
        }
        if (stripEl) {
            stripEl.innerHTML = rpgUI.PILLARS.map(p => `
                <div class="rpg-live-pillar-chip">
                    <span style="color: ${p.cor}; font-weight: 800;">${UI.escapeHtml(p.sigla)}</span>
                    <strong>${calc.pilares[p.id]}/20</strong>
                </div>
            `).join('');
        }
    },

    async submitAvaliacaoDesempenho(e) {
        e.preventDefault();
        if (this.rpgFormState.apto_sparring === null) {
            UI.showToast('Selecione se o aluno está Apto para Sparring (Sim ou Não).', 'warning');
            const scrollEl = document.querySelector('.rpg-modal-scroll-body');
            if (scrollEl) scrollEl.scrollTop = 0;
            return;
        }

        const alunoId = document.getElementById('desempenho-aluno-id').value;
        const data_avaliacao = document.getElementById('desempenho-data').value;
        const observacoes_instrutor = (document.getElementById('desempenho-obs')?.value || '').trim();

        const btn = document.getElementById('btn-salvar-desempenho');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<div class="spinner"></div> Salvando...`;
        }

        try {
            const res = await API.post(`/alunos/${alunoId}/avaliacoes-desempenho`, {
                modelo_avaliacao: 'rpg',
                data_avaliacao,
                apto_sparring: this.rpgFormState.apto_sparring,
                criterios: this.rpgFormState.criterios,
                observacoes_instrutor
            });

            if (!res.success) throw new Error(res.error || 'Erro ao registrar avaliação RPG.');

            UI.showToast(res.message || 'Avaliação Técnica RPG registrada com sucesso!', 'success');
            UI.closeModal('modal-avaliacao-desempenho');

            await this.openDossier(this.currentAlunoId);
            this.switchTab('desempenho');
            if (window.AlunosModule) AlunosModule.loadAlunos();

        } catch (err) {
            UI.showToast('Erro ao salvar avaliação: ' + err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `💾 Salvar Avaliação RPG`;
            }
        }
    },

    async deleteAvaliacaoDesempenho(evalId) {
        if (!confirm('Deseja realmente excluir este registro de avaliação de desempenho?')) return;

        try {
            const res = await API.delete(`/alunos/${this.currentAlunoId}/avaliacoes-desempenho/${evalId}`);
            if (!res.success) throw new Error(res.error || 'Erro ao excluir.');

            UI.showToast('Avaliação excluída com sucesso.', 'success');
            await this.openDossier(this.currentAlunoId);
            this.switchTab('desempenho');
            if (window.AlunosModule) AlunosModule.loadAlunos();
        } catch (err) {
            UI.showToast('Erro ao excluir avaliação: ' + err.message, 'error');
        }
    }
};

window.AlunoDetalhesModule = AlunoDetalhesModule;
